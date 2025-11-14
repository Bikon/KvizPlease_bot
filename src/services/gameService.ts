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

/**
 * Internal function to synchronize games from a source URL
 * Fetches HTML, parses games, filters by excluded types, and upserts to database
 * @param chatId - The chat ID to sync games for
 * @param sourceUrl - The URL to fetch games from
 * @returns Object with counts of added, skipped, and excluded games
 * @throws {Error} If HTML fetch or parsing fails
 */
async function syncGamesInternal(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
    const html = await grabPageHtmlWithFilters(sourceUrl);
    log.info(`[Chat ${chatId}] HTML grabbed & full list loaded`);

    const raw = parseQuizPlease(html, sourceUrl);
    
    // Получаем исключенные типы пакетов(игр) для этого чата
    const excludedTypes = new Set((await listExcludedTypes(chatId)).map(t => t.toLowerCase()));

    let ok = 0, skip = 0, excluded = 0;
    for (const r of raw) {
        try {
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
        } catch (error) {
            log.error(`[Sync] Failed to process game ${r.externalId}:`, error);
            skip++;
        }
    }
    log.info(`[Chat ${chatId}] Synced games: ${ok}, excluded: ${excluded}, skipped: ${skip}`);
    return { added: ok, skipped: skip, excluded };
}

// Initialize queue with the sync function
syncQueue.setSyncFunction(syncGamesInternal);

/**
 * Synchronizes games from a source URL using a queue system
 * Prevents concurrent syncs for the same chat and limits overall concurrency
 * @param chatId - The chat ID to sync games for
 * @param sourceUrl - The URL to fetch games from
 * @returns Promise that resolves with sync results
 */
export async function syncGames(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
    const status = syncQueue.getStatus();
    log.info(`[Chat ${chatId}] Sync requested. Queue status: ${status.running}/${status.maxConcurrency} running, ${status.queued} queued`);
    return await syncQueue.enqueue(chatId, sourceUrl);
}

/**
 * Gets filtered upcoming games for a chat using configured filters
 * @param chatId - The chat ID to get games for
 * @returns Promise that resolves to array of upcoming games
 */
export async function getFilteredUpcoming(chatId: string) {
    return await findUpcomingGames(config.filters.daysAhead, config.filters.districts, chatId);
}

/**
 * Gets upcoming game groups for a chat using configured filters
 * @param chatId - The chat ID to get groups for
 * @returns Promise that resolves to array of game groups
 */
export async function getUpcomingGroups(chatId: string) {
    return await findUpcomingGroups(config.filters.daysAhead, config.filters.districts, chatId);
}
