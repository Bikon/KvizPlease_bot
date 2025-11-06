import { grabPageHtmlWithFilters } from '../scraper/fetch.js';
import { parseQuizPlease } from '../scraper/parse.js';
import { normalize } from '../scraper/normalize.js';
import { upsertGame, findUpcomingGames, findUpcomingGroups } from '../db/repositories.js';
import { config } from '../config.js';
import { log } from '../utils/logger.js';
import { syncQueue } from '../utils/syncQueue.js';

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

async function syncGamesInternal(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number }> {
    const html = await grabPageHtmlWithFilters(sourceUrl);
    log.info(`[Chat ${chatId}] HTML grabbed & full list loaded`);

    const raw = parseQuizPlease(html, sourceUrl);

    let ok = 0, skip = 0;
    for (const r of raw) {
        const g = normalize(r);
        if (!g) { skip++; continue; }

        const { groupKey } = extractGroupKey(r.title);
        g.groupKey = groupKey;

        await upsertGame(g, chatId, sourceUrl);
        ok++;
    }
    log.info(`[Chat ${chatId}] Synced games: ${ok}, skipped: ${skip}`);
    return { added: ok, skipped: skip };
}

// Initialize queue with the sync function
syncQueue.setSyncFunction(syncGamesInternal);

export async function syncGames(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number }> {
    const status = syncQueue.getStatus();
    log.info(`[Chat ${chatId}] Sync requested. Queue status: ${status.running}/${status.maxConcurrency} running, ${status.queued} queued`);
    return await syncQueue.enqueue(chatId, sourceUrl);
}

export async function getFilteredUpcoming(chatId: string) {
    return await findUpcomingGames(config.filters.daysAhead, config.filters.districts, chatId);
}

export async function getUpcomingGroups(chatId: string) {
    return await findUpcomingGroups(config.filters.daysAhead, config.filters.districts, chatId);
}
