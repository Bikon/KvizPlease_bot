import { grabPageHtmlWithFilters } from '../scraper/fetch.js';
import { parseQuizPlease } from '../scraper/parse.js';
import { normalize } from '../scraper/normalize.js';
import { upsertGame, findUpcomingGames, findUpcomingGroups, listExcludedTypes } from '../db/repositories.js';
import { config } from '../config.js';
import { log } from '../utils/logger.js';

function extractGroupKey(title: string) {
    // На входе title вроде: "[music party] рашн эдишн #7" или "Квиз, плиз! #1212"
    const num = title.match(/#(\d+)/)?.[1] ?? '';
    // тип: всё до " #"
    let typeName = title.split('#')[0].trim();
    typeName = typeName.replace(/\s+$/,'');
    // нормализуем "Квиз, плиз!" → "Квиз, плиз"
    typeName = typeName.replace(/!+$/,'').trim();
    return { groupKey: `${typeName}#${num}`, typeName, number: num };
}

export async function syncGames() {
    const html = await grabPageHtmlWithFilters(config.sourceUrl);
    log.info('HTML grabbed (prefiltered URL) & full list loaded');

    const raw = parseQuizPlease(html, config.sourceUrl);
    const excludedTypes = new Set((await listExcludedTypes()).map(t => t.toLowerCase()));

    let ok = 0, skip = 0;
    for (const r of raw) {
        // отфильтруем типы ещё на этапе синка
        const name = r.gameType ?? r.title.split('#')[0].trim();
        const normalizedType = name.replace(/!+$/,'').trim().toLowerCase();
        if (excludedTypes.has(normalizedType)) {
            skip++;
            continue;
        }

        const g = normalize(r);
        if (!g) { skip++; continue; }

        const { groupKey } = extractGroupKey(r.title);
        g.groupKey = groupKey;

        await upsertGame(g);
        ok++;
    }
    log.info(`Synced games: ${ok}, skipped: ${skip}`);
}

export async function getFilteredUpcoming() {
    return await findUpcomingGames(config.filters.daysAhead, config.filters.districts);
}

export async function getUpcomingGroups() {
    return await findUpcomingGroups(config.filters.daysAhead, config.filters.districts);
}
