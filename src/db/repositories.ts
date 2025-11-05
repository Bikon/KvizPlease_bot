import { pool } from './pool.js';
import { Game } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const upsertSqlPath = path.resolve(process.cwd(), 'sql', 'upsert_game.sql');
let UPSERT_SQL = '';
(async () => { UPSERT_SQL = await fs.readFile(upsertSqlPath, 'utf8'); })();

// базовый UPSERT игры
export async function upsertGame(game: Game) {
    const {
        externalId, title, dateTime, venue, district, address, price, difficulty, status, url, groupKey
    } = game;
    await pool.query(UPSERT_SQL, [
        externalId, title, dateTime, venue ?? null, district ?? null, address ?? null,
        price ?? null, difficulty ?? null, status ?? null, url, groupKey ?? null
    ]);
}

// получить все будущие игры с учётом флагов и исключений
export async function findUpcomingGames(daysAhead: number, allowedDistricts: string[]) {
    const res = await pool.query(
        `SELECT g.*
         FROM games g
                  LEFT JOIN excluded_groups eg ON eg.group_key = g.group_key
                  LEFT JOIN excluded_types et  ON et.type_name = split_part(g.group_key, '#', 1) -- имя типа лежит до '#'
         WHERE g.date_time >= now()
           AND g.date_time <= now() + ($1::text || ' days')::interval
        AND (CASE WHEN $2::text[] IS NULL THEN true ELSE g.district = ANY($2) END)
           AND NOT g.played
           AND NOT g.excluded
           AND eg.group_key IS NULL
           AND et.type_name IS NULL
         ORDER BY g.group_key NULLS LAST, g.date_time ASC`,
        [String(daysAhead), allowedDistricts.length ? allowedDistricts : null]
    );
    return res.rows as any[];
}

// сгруппировать на стороне БД признаком group_key (для /groups)
export async function findUpcomingGroups(daysAhead: number, allowedDistricts: string[]) {
    const res = await pool.query(
        `WITH base AS (
       SELECT g.*
         FROM games g
         LEFT JOIN excluded_groups eg ON eg.group_key = g.group_key
         LEFT JOIN excluded_types et  ON et.type_name = split_part(g.group_key, '#', 1)
        WHERE g.date_time >= now()
          AND g.date_time <= now() + ($1::text || ' days')::interval
          AND (CASE WHEN $2::text[] IS NULL THEN true ELSE g.district = ANY($2) END)
          AND NOT g.excluded
          AND eg.group_key IS NULL
          AND et.type_name IS NULL
     )
     SELECT group_key,
            split_part(group_key,'#',1) AS type_name,
            split_part(group_key,'#',2) AS num,
            BOOL_OR(played) as played,
            COUNT(*) as cnt
       FROM base
      GROUP BY group_key
      ORDER BY type_name, CAST(NULLIF(split_part(group_key,'#',2),'') AS INT) NULLS LAST;`,
        [String(daysAhead), allowedDistricts.length ? allowedDistricts : null]
    );
    return res.rows;
}

// пометки и исключения
export async function markGroupPlayed(groupKey: string) {
    await pool.query(`UPDATE games SET played = true, updated_at = now() WHERE group_key = $1`, [groupKey]);
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

export async function listExcludedTypes(): Promise<string[]> {
    const r = await pool.query(`SELECT type_name FROM excluded_types ORDER BY type_name`);
    return r.rows.map(x => x.type_name);
}

export async function excludeType(typeName: string) {
    await pool.query(`INSERT INTO excluded_types(type_name) VALUES ($1) ON CONFLICT DO NOTHING`, [typeName]);
}

export async function unexcludeType(typeName: string) {
    await pool.query(`DELETE FROM excluded_types WHERE type_name=$1`, [typeName]);
}

export async function insertPoll(pollId: string, chatId: string, messageId: number, groupKey?: string) {
    await pool.query(
        'INSERT INTO polls (poll_id, chat_id, message_id, group_key) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [pollId, chatId, messageId, groupKey ?? null]
    );
}

export async function mapPollOption(pollId: string, optionId: number, gameExternalId: string | null, isUnavailable = false) {
    await pool.query(
        'INSERT INTO poll_options (poll_id, option_id, game_external_id, is_unavailable) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [pollId, optionId, gameExternalId, isUnavailable]
    );
}

export async function upsertVote(pollId: string, userId: number, optionIds: number[]) {
    await pool.query(
        `INSERT INTO poll_votes (poll_id, user_id, option_ids)
     VALUES ($1,$2,$3)
     ON CONFLICT(poll_id, user_id) DO UPDATE SET option_ids = EXCLUDED.option_ids, voted_at = now()`,
        [pollId, userId, optionIds]
    );
}
