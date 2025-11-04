import { grabPageHtmlWithFilters } from '../scraper/fetch.js';
import { parseQuizPlease } from '../scraper/parse.js';
import { normalize } from '../scraper/normalize.js';
import {
  upsertGame, findUpcomingGames, isGroupProcessed, markGroupProcessed
} from '../db/repositories.js';
import { config } from '../config.js';
import { log } from '../utils/logger.js';

export async function syncGames() {
  const html = await grabPageHtmlWithFilters(config.sourceUrl);
  const raw = parseQuizPlease(html, config.sourceUrl);
  let ok = 0, skip = 0;
  for (const r of raw) {
    const g = normalize(r);
    if (!g) { skip++; continue; }
    await upsertGame(g);
    ok++;
  }
  log.info(`Synced games: ${ok}, skipped: ${skip}`);
}

export async function getFilteredUpcoming() {
  const games = await findUpcomingGames(config.filters.daysAhead, config.filters.districts);
  return games;
}

export type Group = {
  groupKey: string;
  name: string;
  number: string;
  items: any[];
};

export async function groupUpcomingByTypeAndNumber(): Promise<Group[]> {
  const rows = await getFilteredUpcoming();
  const map = new Map<string, Group>();

  for (const r of rows) {
    let gk: string | null = r.group_key;
    if (!gk && r.title) {
      const m = String(r.title).match(/^(.*?)\s*#(\d+)/);
      if (m) gk = `${m[1].trim()}#${m[2]}`;
    }
    if (!gk) continue;

    const [name, number] = gk.split('#');
    if (!map.has(gk)) {
      map.set(gk, { groupKey: gk, name, number, items: [] });
    }
    map.get(gk)!.items.push(r);
  }

  const groups: Group[] = [];
  for (const g of map.values()) {
    if (g.items.length < 2) continue;
    if (await isGroupProcessed(g.groupKey)) continue;
    groups.push(g);
  }
  return groups;
}

export async function markProcessed(groupKey: string) {
  await markGroupProcessed(groupKey);
}
