import * as cheerio from 'cheerio';

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

const MAX_PAGINATION_PAGES = 20;

async function syncGamesInternal(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
    const allRaw = [];

    // 1) Load first page to detect max page from paginator
    const firstUrl = new URL(sourceUrl);
    firstUrl.searchParams.set('page', '1');
    const firstPageUrl = firstUrl.toString();

    const firstHtml = await grabPageHtmlWithFilters(firstPageUrl);
    log.info(`[Chat ${chatId}] HTML grabbed for page 1`);

    // Parse max page from paginator
    let maxPageFromPaginator = 1;
    try {
        const $ = cheerio.load(firstHtml);
        $('.game-pagination__list-item p').each((_, el) => {
            const txt = $(el).text().trim();
            const n = Number.parseInt(txt, 10);
            if (!Number.isNaN(n) && n > maxPageFromPaginator) {
                maxPageFromPaginator = n;
            }
        });
        log.info(`[Chat ${chatId}] Detected max page from paginator: ${maxPageFromPaginator}`);
    } catch (err) {
        log.warn(`[Chat ${chatId}] Failed to detect max page from paginator`, err);
    }

    const maxPage = Math.min(maxPageFromPaginator, MAX_PAGINATION_PAGES);

    // Parse first page
    const firstRaw = parseQuizPlease(firstHtml, firstPageUrl);
    log.info(`[Chat ${chatId}] Parsed ${firstRaw.length} games from page 1`);
    allRaw.push(...firstRaw);

    // 2) Iterate remaining pages up to detected maxPage
    for (let page = 2; page <= maxPage; page++) {
        const url = new URL(sourceUrl);
        url.searchParams.set('page', String(page));

        const pageUrl = url.toString();
        const html = await grabPageHtmlWithFilters(pageUrl);
        log.info(`[Chat ${chatId}] HTML grabbed for page ${page}`);

        const rawPage = parseQuizPlease(html, pageUrl);
        log.info(`[Chat ${chatId}] Parsed ${rawPage.length} games from page ${page}`);

        // Safety: if some later page is unexpectedly empty, stop early
        if (rawPage.length === 0) break;

        allRaw.push(...rawPage);
    }

    const raw = allRaw;
    
    // Получаем исключенные типы пакетов(игр) для этого чата
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
    return await findUpcomingGames(chatId);
}

export async function getUpcomingGroups(chatId: string) {
    return await findUpcomingGroups(chatId);
}
