import fs from 'node:fs/promises';
import path from 'node:path';

import { pool } from './pool.js';
import type { Game } from '../types.js';

export { pool };

let pollsTitleColumnEnsured = false;
let pollVotesUserNameColumnEnsured = false;

async function ensurePollTitleColumn() {
    if (pollsTitleColumnEnsured) return;
    await pool.query('ALTER TABLE polls ADD COLUMN IF NOT EXISTS title TEXT');
    pollsTitleColumnEnsured = true;
}

async function ensurePollVotesUserNameColumn() {
    if (pollVotesUserNameColumnEnsured) return;
    await pool.query('ALTER TABLE poll_votes ADD COLUMN IF NOT EXISTS user_name TEXT');
    pollVotesUserNameColumnEnsured = true;
}

const upsertSqlPath = path.resolve(process.cwd(), 'sql', 'upsert_game.sql');
let UPSERT_SQL = '';
(async () => { UPSERT_SQL = await fs.readFile(upsertSqlPath, 'utf8'); })();

// базовый UPSERT игры
export async function upsertGame(game: Game, chatId: string, sourceUrl: string) {
    const {
        externalId, title, dateTime, venue, district, address, price, difficulty, status, url, groupKey
    } = game;
    await pool.query(UPSERT_SQL, [
        chatId, externalId, title, dateTime, venue ?? null, district ?? null, address ?? null,
        price ?? null, difficulty ?? null, status ?? null, url, groupKey ?? null, sourceUrl
    ]);
}

// получить все будущие игры с учётом флагов и исключений
export async function findUpcomingGames(daysAhead: number, allowedDistricts: string[], chatId: string) {
    const res = await pool.query(
        `SELECT g.*
         FROM games g
                  LEFT JOIN excluded_groups eg ON eg.group_key = g.group_key
                  LEFT JOIN chat_excluded_types cet  ON cet.type_name = split_part(g.group_key, '#', 1) AND cet.chat_id = $3
                  LEFT JOIN chat_played_groups cpg ON cpg.group_key = g.group_key AND cpg.chat_id = $3
         WHERE g.chat_id = $3
           AND g.date_time >= now()
           AND g.date_time <= now() + ($1::text || ' days')::interval
           AND (CASE WHEN $2::text[] IS NULL THEN true ELSE g.district = ANY($2) END)
           AND NOT g.excluded
           AND eg.group_key IS NULL
           AND cet.type_name IS NULL
           AND cpg.group_key IS NULL
         ORDER BY g.group_key NULLS LAST, g.date_time ASC`,
        [String(daysAhead), allowedDistricts.length ? allowedDistricts : null, chatId]
    );
    return res.rows as any[];
}

// получить количество всех будущих игр с учётом основных фильтров (для точной статистики синхронизации)
export async function countAllUpcomingGames(chatId: string, daysAhead: number = 30, allowedDistricts: string[] = []) {
    const res = await pool.query(
        `SELECT COUNT(*) as count
         FROM games g
         LEFT JOIN excluded_groups eg ON eg.group_key = g.group_key
         LEFT JOIN chat_excluded_types cet ON cet.type_name = split_part(g.group_key, '#', 1) AND cet.chat_id = $1
         LEFT JOIN chat_played_groups cpg ON cpg.group_key = g.group_key AND cpg.chat_id = $1
         WHERE g.chat_id = $1
           AND g.date_time >= now()
           AND g.date_time <= now() + ($2::text || ' days')::interval
           AND (CASE WHEN $3::text[] IS NULL THEN true ELSE g.district = ANY($3) END)
           AND NOT g.excluded
           AND eg.group_key IS NULL
           AND cet.type_name IS NULL
           AND cpg.group_key IS NULL`,
        [chatId, String(daysAhead), allowedDistricts.length ? allowedDistricts : null]
    );
    return parseInt(res.rows[0]?.count || '0', 10);
}

// сгруппировать на стороне БД признаком group_key (для /groups)
export async function findUpcomingGroups(daysAhead: number, allowedDistricts: string[], chatId: string) {
    const res = await pool.query(
        `WITH base AS (
       SELECT g.*
         FROM games g
         LEFT JOIN excluded_groups eg ON eg.group_key = g.group_key
         LEFT JOIN chat_excluded_types cet  ON cet.type_name = split_part(g.group_key, '#', 1) AND cet.chat_id = $3
        WHERE g.chat_id = $3
          AND g.date_time >= now()
          AND g.date_time <= now() + ($1::text || ' days')::interval
          AND (CASE WHEN $2::text[] IS NULL THEN true ELSE g.district = ANY($2) END)
          AND NOT g.excluded
          AND eg.group_key IS NULL
          AND cet.type_name IS NULL
     )
     SELECT group_key,
            split_part(group_key,'#',1) AS type_name,
            split_part(group_key,'#',2) AS num,
            EXISTS (
                SELECT 1 FROM chat_played_groups cpg WHERE cpg.group_key = base.group_key AND cpg.chat_id = $3
            ) as played,
            COUNT(*) as cnt,
            SUM(CASE WHEN base.registered = true THEN 1 ELSE 0 END) as registered_count,
            EXISTS (
                SELECT 1 FROM polls p WHERE p.group_key = base.group_key AND p.chat_id = $3
            ) AS polled_by_package,
            EXISTS (
                SELECT 1 FROM games g2
                JOIN poll_options po ON po.game_external_id = g2.external_id
                JOIN polls p2 ON p2.poll_id = po.poll_id
                WHERE g2.group_key = base.group_key AND g2.chat_id = $3 AND p2.chat_id = $3 AND p2.group_key IS NULL
            ) AS polled_by_date
       FROM base
      GROUP BY group_key
      ORDER BY type_name, CAST(NULLIF(split_part(group_key,'#',2),'') AS INT) NULLS LAST;`,
        [String(daysAhead), allowedDistricts.length ? allowedDistricts : null, chatId]
    );
    return res.rows;
}

// пометки и исключения
export async function markGroupPlayed(chatId: string, groupKey: string) {
    await pool.query(`INSERT INTO chat_played_groups(chat_id, group_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chatId, groupKey]);
}

export async function unmarkGroupPlayed(chatId: string, groupKey: string) {
    await pool.query(`DELETE FROM chat_played_groups WHERE chat_id=$1 AND group_key=$2`, [chatId, groupKey]);
}

export async function excludeGroup(groupKey: string) {
    await pool.query(`INSERT INTO excluded_groups(group_key) VALUES ($1) ON CONFLICT DO NOTHING`, [groupKey]);
    await pool.query(`UPDATE games SET excluded = true, updated_at = now() WHERE group_key = $1`, [groupKey]);
}

export async function unexcludeGroup(groupKey: string) {
    await pool.query(`DELETE FROM excluded_groups WHERE group_key=$1`, [groupKey]);
    // не трогаем истории excluded = true у games, это мягкая «история», но можем вернуть:
    await pool.query(`UPDATE games SET excluded = false, updated_at = now() WHERE group_key = $1`, [groupKey]);
}

export async function listExcludedTypes(chatId: string): Promise<string[]> {
    const r = await pool.query(`SELECT type_name FROM chat_excluded_types WHERE chat_id=$1 ORDER BY type_name`, [chatId]);
    return r.rows.map(x => x.type_name);
}

export async function excludeType(chatId: string, typeName: string) {
    await pool.query(`INSERT INTO chat_excluded_types(chat_id, type_name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chatId, typeName]);
}

export async function unexcludeType(chatId: string, typeName: string) {
    await pool.query(`DELETE FROM chat_excluded_types WHERE chat_id=$1 AND type_name=$2`, [chatId, typeName]);
}

export async function insertPoll(pollId: string, chatId: string, messageId: number, groupKey: string | null = null, title: string | null = null) {
    await ensurePollTitleColumn();
    await pool.query(
        'INSERT INTO polls (poll_id, chat_id, message_id, group_key, title) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [pollId, chatId, messageId, groupKey, title]
    );
}

export async function mapPollOption(pollId: string, optionId: number, gameExternalId: string | null, isUnavailable = false) {
    await pool.query(
        'INSERT INTO poll_options (poll_id, option_id, game_external_id, is_unavailable) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [pollId, optionId, gameExternalId, isUnavailable]
    );
}

export async function pollExists(pollId: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM polls WHERE poll_id = $1 LIMIT 1', [pollId]);
    return res.rowCount > 0;
}

export async function upsertVote(pollId: string, userId: number, optionIds: number[], userName: string | null) {
    await ensurePollVotesUserNameColumn();
    await pool.query(
        `INSERT INTO poll_votes (poll_id, user_id, user_name, option_ids)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(poll_id, user_id) DO UPDATE SET option_ids = EXCLUDED.option_ids, user_name = EXCLUDED.user_name, voted_at = now()`,
        [pollId, userId, userName, optionIds]
    );
}

// simple app settings
export async function getSetting(key: string): Promise<string | null> {
    const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
    return r.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
    await pool.query(
        `INSERT INTO app_settings(key, value) VALUES ($1,$2)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [key, value]
    );
}

export async function getChatSetting(chatId: string, key: string): Promise<string | null> {
    const r = await pool.query('SELECT value FROM chat_settings WHERE chat_id=$1 AND key=$2', [chatId, key]);
    return r.rows[0]?.value ?? null;
}

export async function setChatSetting(chatId: string, key: string, value: string): Promise<void> {
    await pool.query(
        `INSERT INTO chat_settings(chat_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT(chat_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [chatId, key, value]
    );
}

export async function resetChatData(chatId: string): Promise<void> {
    // Удаляем настройки чата
    await pool.query('DELETE FROM chat_settings WHERE chat_id=$1', [chatId]);
    
    // Удаляем played groups чата
    await pool.query('DELETE FROM chat_played_groups WHERE chat_id=$1', [chatId]);
    
    // Удаляем excluded types чата
    await pool.query('DELETE FROM chat_excluded_types WHERE chat_id=$1', [chatId]);
    
    // Удаляем игры этого чата
    await pool.query('DELETE FROM games WHERE chat_id=$1', [chatId]);
    
    // Удаляем опросы чата
    await pool.query('DELETE FROM polls WHERE chat_id=$1', [chatId]);
    
    // Удаляем информацию о команде
    await pool.query('DELETE FROM team_info WHERE chat_id=$1', [chatId]);
}

export async function changeSourceUrl(chatId: string, newUrl: string): Promise<void> {
    // Очищаем все данные чата при смене источника
    await pool.query('DELETE FROM chat_played_groups WHERE chat_id=$1', [chatId]);
    await pool.query('DELETE FROM chat_excluded_types WHERE chat_id=$1', [chatId]);
    await pool.query('DELETE FROM games WHERE chat_id=$1', [chatId]);
    await pool.query('DELETE FROM polls WHERE chat_id=$1', [chatId]);
    await pool.query('DELETE FROM chat_settings WHERE chat_id=$1 AND key=$2', [chatId, 'last_sync_at']);
    await pool.query('DELETE FROM chat_settings WHERE chat_id=$1 AND key=$2', [chatId, 'pending_source_url']);
    
    // Устанавливаем новый источник
    await setChatSetting(chatId, 'source_url', newUrl);
}

export async function deletePastGames(chatId: string): Promise<number> {
    const res = await pool.query('DELETE FROM games WHERE chat_id=$1 AND date_time < now() RETURNING id', [chatId]);
    return res.rowCount ?? 0;
}

export async function listChatsWithSourceAndLastSync(): Promise<Array<{ chat_id: string; source_url: string; last_sync_at: string | null }>> {
    const r = await pool.query(
        `SELECT s.chat_id,
                s.value AS source_url,
                ls.value AS last_sync_at
           FROM chat_settings s
           LEFT JOIN chat_settings ls ON ls.chat_id = s.chat_id AND ls.key = 'last_sync_at'
          WHERE s.key = 'source_url'`
    );
    return r.rows;
}

// Team information management
export interface TeamInfo {
    team_name: string;
    captain_name: string;
    email: string;
    phone: string;
}

export async function getTeamInfo(chatId: string): Promise<TeamInfo | null> {
    const r = await pool.query(
        'SELECT team_name, captain_name, email, phone FROM team_info WHERE chat_id=$1',
        [chatId]
    );
    return r.rows[0] ?? null;
}

export async function saveTeamInfo(chatId: string, info: TeamInfo): Promise<void> {
    await pool.query(
        `INSERT INTO team_info (chat_id, team_name, captain_name, email, phone)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (chat_id) DO UPDATE 
         SET team_name = EXCLUDED.team_name,
             captain_name = EXCLUDED.captain_name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             updated_at = now()`,
        [chatId, info.team_name, info.captain_name, info.email, info.phone]
    );
}

export async function deleteTeamInfo(chatId: string): Promise<void> {
    await pool.query('DELETE FROM team_info WHERE chat_id=$1', [chatId]);
}

// Registration management
export async function markGameRegistered(chatId: string, externalId: string): Promise<void> {
    const res = await pool.query<{ group_key: string | null }>(
        'SELECT group_key FROM games WHERE chat_id = $1 AND external_id = $2',
        [chatId, externalId]
    );
    const groupKey = res.rows[0]?.group_key;

    if (groupKey) {
        await pool.query(
            'UPDATE games SET registered = false, registered_at = null WHERE chat_id = $1 AND group_key = $2 AND external_id <> $3',
            [chatId, groupKey, externalId]
        );
    }

    await pool.query(
        'UPDATE games SET registered = true, registered_at = now() WHERE chat_id = $1 AND external_id = $2',
        [chatId, externalId]
    );
}

export async function unmarkGameRegistered(chatId: string, externalId: string): Promise<void> {
    await pool.query(
        'UPDATE games SET registered = false, registered_at = null WHERE chat_id = $1 AND external_id = $2',
        [chatId, externalId]
    );
}

export async function markPollProcessedForRegistration(pollId: string): Promise<void> {
    await pool.query(
        'UPDATE polls SET processed_for_registration = true WHERE poll_id = $1',
        [pollId]
    );
}

// Poll analysis for registration
export interface PollWithVotes {
    poll_id: string;
    message_id: number;
    group_key: string | null;
    title: string | null;
    created_at: string;
    vote_count: number;
}

export async function findUnprocessedPollsWithVotes(chatId: string): Promise<PollWithVotes[]> {
    await ensurePollTitleColumn();
    const r = await pool.query(
        `SELECT p.poll_id, p.message_id, p.group_key, p.title, p.created_at,
                COUNT(DISTINCT pv.user_id) as vote_count
         FROM polls p
         LEFT JOIN poll_votes pv ON pv.poll_id = p.poll_id
         WHERE p.chat_id = $1 
           AND p.processed_for_registration = false
         GROUP BY p.poll_id, p.message_id, p.group_key, p.title, p.created_at
         HAVING COUNT(DISTINCT pv.user_id) > 0
         ORDER BY p.created_at DESC`,
        [chatId]
    );
    return r.rows.map((row) => ({
        poll_id: row.poll_id,
        message_id: row.message_id,
        group_key: row.group_key,
        title: row.title,
        created_at: row.created_at,
        vote_count: Number(row.vote_count ?? 0),
    }));
}

export interface PollOptionVotes {
    option_id: number;
    game_external_id: string | null;
    is_unavailable: boolean;
    vote_count: number;
    voters: string[];
}

export async function getPollOptionVotes(pollId: string): Promise<PollOptionVotes[]> {
    await ensurePollVotesUserNameColumn();
    const r = await pool.query(
        `SELECT po.option_id, po.game_external_id, po.is_unavailable,
                COUNT(DISTINCT pv.user_id) as vote_count,
                ARRAY_AGG(DISTINCT pv.user_name) FILTER (WHERE pv.user_name IS NOT NULL) AS voter_names
         FROM poll_options po
         LEFT JOIN poll_votes pv ON pv.poll_id = po.poll_id 
                                  AND po.option_id = ANY(pv.option_ids)
         WHERE po.poll_id = $1
         GROUP BY po.option_id, po.game_external_id, po.is_unavailable
         ORDER BY vote_count DESC, po.option_id`,
        [pollId]
    );
    return r.rows.map((row) => ({
        option_id: row.option_id,
        game_external_id: row.game_external_id,
        is_unavailable: row.is_unavailable,
        vote_count: Number(row.vote_count ?? 0),
        voters: (row.voter_names ?? []).filter((name: string | null) => !!name) as string[],
    }));
}

export async function listRegistrationsByGame(chatId: string): Promise<Map<string, string[]>> {
    await ensurePollVotesUserNameColumn();
    const res = await pool.query(
        `SELECT po.game_external_id,
                ARRAY_AGG(DISTINCT pv.user_name) FILTER (WHERE pv.user_name IS NOT NULL) AS voter_names
         FROM poll_options po
         JOIN polls p ON p.poll_id = po.poll_id
         LEFT JOIN poll_votes pv ON pv.poll_id = po.poll_id
                                  AND po.option_id = ANY(pv.option_ids)
         WHERE p.chat_id = $1
           AND po.game_external_id IS NOT NULL
         GROUP BY po.game_external_id`,
        [chatId]
    );
    const map = new Map<string, string[]>();
    for (const row of res.rows) {
        const key = row.game_external_id as string | null;
        if (!key) continue;
        const names = (row.voter_names ?? []).filter((name: string | null) => !!name) as string[];
        if (names.length) {
            map.set(key, names);
        }
    }
    return map;
}

export async function getGameByExternalId(chatId: string, externalId: string) {
    const r = await pool.query(
        'SELECT * FROM games WHERE chat_id = $1 AND external_id = $2',
        [chatId, externalId]
    );
    return r.rows[0] ?? null;
}

