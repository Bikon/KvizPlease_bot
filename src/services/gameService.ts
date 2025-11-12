import { config } from '../config.js';
import {
    findUpcomingGames,
    findUpcomingGroups,
    listExcludedTypes,
    upsertGame,
} from '../db/repositories.js';
import { grabPageHtmlWithFilters } from '../scraper/fetch.js';
import { normalize } from '../scraper/normalize.js';
import { parseQuizPlease } from '../scraper/parse.js';
import { log } from '../utils/logger.js';
import { extractGameNumber } from '../utils/patterns.js';
import { syncQueue } from '../utils/syncQueue.js';

function extractGroupKey(title: string) {
    // На входе title вроде: "[music party] рашн эдишн #7" или "Квиз, плиз! #1212"
    const num = extractGameNumber(title) ?? '';
    // тип: всё до " #"
    let typeName = title.split('#')[0].trim();
    typeName = typeName.replace(/\s+$/,'');
    // нормализуем "Квиз, плиз!" → "Квиз, плиз"
    typeName = typeName.replace(/!+$/,'').trim();
    return { groupKey: `${typeName}#${num}`, typeName, number: num };
}

async function syncGamesInternal(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
    const html = await grabPageHtmlWithFilters(sourceUrl);
    log.info(`[Chat ${chatId}] HTML grabbed & full list loaded`);

    const raw = parseQuizPlease(html, sourceUrl);
    
    // Получаем исключенные типы для этого чата
    const excludedTypes = new Set((await listExcludedTypes(chatId)).map(t => t.toLowerCase()));

    let ok = 0, skip = 0, excluded = 0;
    for (const r of raw) {
        const g = normalize(r);
        if (!g) { skip++; continue; }

        const { groupKey, typeName } = extractGroupKey(r.title);
        g.groupKey = groupKey;
        
        // Пропускаем игры исключенных типов
        if (excludedTypes.has(typeName.toLowerCase())) {
            excluded++;
            continue;
        }

        await upsertGame(g, chatId, sourceUrl);
        ok++;
    }
    log.info(`[Chat ${chatId}] Synced games: ${ok}, excluded: ${excluded}, skipped: ${skip}`);
    return { added: ok, skipped: skip, excluded };
}

// Initialize queue with the sync function
syncQueue.setSyncFunction(syncGamesInternal);

export async function syncGames(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
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
