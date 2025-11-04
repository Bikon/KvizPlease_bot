import { pool } from './pool.js';
import { Game } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const upsertSqlPath = path.resolve(process.cwd(), 'sql', 'upsert_game.sql');
let UPSERT_SQL = '';
(async () => { UPSERT_SQL = await fs.readFile(upsertSqlPath, 'utf8'); })();

export async function upsertGame(game: Game) {
  const {
    externalId, title, dateTime, venue, district, address, price, difficulty, status, url, groupKey
  } = game;
  await pool.query(UPSERT_SQL, [
    externalId, title, dateTime, venue ?? null, district ?? null, address ?? null,
    price ?? null, difficulty ?? null, status ?? null, url, groupKey ?? null
  ]);
}

export async function findUpcomingGames(daysAhead: number, allowedDistricts: string[]) {
  const res = await pool.query(
    `SELECT * FROM games
     WHERE date_time >= now()
       AND date_time <= now() + ($1::text || ' days')::interval
       AND ($2::text[] IS NULL OR district = ANY($2))
     ORDER BY group_key, date_time ASC`,
    [String(daysAhead), allowedDistricts.length ? allowedDistricts : null]
  );
  return res.rows as any[];
}

export async function isGroupProcessed(groupKey: string) {
  const r = await pool.query('SELECT 1 FROM processed_groups WHERE group_key=$1', [groupKey]);
  return r.rowCount > 0;
}

export async function markGroupProcessed(groupKey: string) {
  await pool.query('INSERT INTO processed_groups(group_key) VALUES($1) ON CONFLICT DO NOTHING', [groupKey]);
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
