import { grabPageHtmlWithFilters } from '../scraper/fetch.js';
import { parseQuizPlease } from '../scraper/parse.js';
import { normalize } from '../scraper/normalize.js';
import { upsertGame, findUpcomingGames, findUpcomingGroups } from '../db/repositories.js';
import { config } from '../config.js';
import { log } from '../utils/logger.js';
import { Group } from '../types.js';

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
    return await findUpcomingGames(config.filters.daysAhead, config.filters.districts);
}

export async function getUpcomingGroups(): Promise<Group[]> {
    return await findUpcomingGroups(config.filters.daysAhead, config.filters.districts);
}
