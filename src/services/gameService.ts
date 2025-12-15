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
import { parseQuizPleaseApi } from '../scraper/parseApi.js';
import { log } from '../utils/logger.js';
import { extractGameNumber } from '../utils/patterns.js';
import { syncQueue } from '../utils/syncQueue.js';
import { extractCityCodeFromUrl } from '../utils/cityCodes.js';
import type { RawGame } from '../types.js';

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

const MAX_PAGINATION_PAGES = 50; // Increased for API pagination
const API_PER_PAGE = 200; // Maximum per_page for API

/**
 * Fetch games from API with pagination
 */
async function fetchGamesFromApi(cityCode: number, startDate: Date): Promise<RawGame[]> {
    const allRaw: RawGame[] = [];
    const seenExternalIds = new Set<string>();
    let currentPage = 1;
    let totalPages = 1;

    do {
        const startDateStr = startDate.toISOString();
        const apiUrl = `https://api.quizplease.ru/api/games/schedule/${cityCode}?per_page=${API_PER_PAGE}&page=${currentPage}&start_date=${startDateStr}&order=date`;

        try {
            log.info(`[API] Fetching page ${currentPage} for city ${cityCode}`);
            const response = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            if (!response.ok) {
                log.warn(`[API] HTTP ${response.status} for page ${currentPage}`);
                break;
            }

            const apiResponse = await response.json();
            const parsed = parseQuizPleaseApi(apiResponse, `https://quizplease.ru/schedule`);

            // Filter duplicates
            const unique = parsed.filter(g => {
                if (!g.externalId) return true;
                if (seenExternalIds.has(g.externalId)) return false;
                seenExternalIds.add(g.externalId);
                return true;
            });

            allRaw.push(...unique);
            log.info(`[API] Page ${currentPage}: ${parsed.length} games parsed, ${unique.length} unique new`);

            // Update pagination info from API response
            if (apiResponse.data?.pagination) {
                totalPages = apiResponse.data.pagination.total_pages || 1;
                log.info(`[API] Total pages: ${totalPages}, current: ${currentPage}`);
            }

            // If no new games on this page, stop
            if (unique.length === 0) {
                log.info(`[API] No new games on page ${currentPage}, stopping`);
                break;
            }

            currentPage++;
        } catch (err) {
            log.error(`[API] Failed to fetch page ${currentPage}:`, err);
            break;
        }
    } while (currentPage <= totalPages && currentPage <= MAX_PAGINATION_PAGES);

    log.info(`[API] Total games fetched: ${allRaw.length}`);
    return allRaw;
}

/**
 * Fetch games from HTML with pagination (legacy method)
 */
async function fetchGamesFromHtml(sourceUrl: string): Promise<RawGame[]> {
    const allRaw: RawGame[] = [];
    const seenExternalIds = new Set<string>();

    // 1) Load first page to detect max page from paginator
    const firstUrl = new URL(sourceUrl);
    firstUrl.searchParams.set('page', '1');
    const firstPageUrl = firstUrl.toString();

    const firstHtml = await grabPageHtmlWithFilters(firstPageUrl);
    log.info(`[HTML] HTML grabbed for page 1`);

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
        log.info(`[HTML] Detected max page from paginator: ${maxPageFromPaginator}`);
    } catch (err) {
        log.warn(`[HTML] Failed to detect max page from paginator`, err);
    }

    const maxPage = Math.min(maxPageFromPaginator, MAX_PAGINATION_PAGES);

    // Parse first page
    const firstRaw = parseQuizPlease(firstHtml, firstPageUrl);
    const firstUnique = firstRaw.filter(g => {
        if (!g.externalId) return true;
        if (seenExternalIds.has(g.externalId)) return false;
        seenExternalIds.add(g.externalId);
        return true;
    });
    log.info(`[HTML] Parsed ${firstRaw.length} games from page 1, unique new: ${firstUnique.length}`);
    allRaw.push(...firstUnique);

    // 2) Iterate remaining pages up to detected maxPage
    for (let page = 2; page <= maxPage; page++) {
        const url = new URL(sourceUrl);
        url.searchParams.set('page', String(page));

        const pageUrl = url.toString();
        const html = await grabPageHtmlWithFilters(pageUrl);
        log.info(`[HTML] HTML grabbed for page ${page}`);

        const rawPage = parseQuizPlease(html, pageUrl);
        const uniquePage = rawPage.filter(g => {
            if (!g.externalId) return true;
            if (seenExternalIds.has(g.externalId)) return false;
            seenExternalIds.add(g.externalId);
            return true;
        });
        log.info(`[HTML] Parsed ${rawPage.length} games from page ${page}, unique new: ${uniquePage.length}`);

        // Если страница не дала ни одной новой игры, дальше нет смысла идти
        if (uniquePage.length === 0) break;

        allRaw.push(...uniquePage);
    }

    return allRaw;
}

async function syncGamesInternal(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
    const startDate = new Date(); // Current date for API start_date parameter
    let raw: RawGame[] = [];

    // Try API first (if city code can be determined)
    const cityCode = extractCityCodeFromUrl(sourceUrl);
    if (cityCode) {
        log.info(`[Chat ${chatId}] Attempting API fetch for city code ${cityCode}`);
        try {
            raw = await fetchGamesFromApi(cityCode, startDate);
            if (raw.length > 0) {
                log.info(`[Chat ${chatId}] Successfully fetched ${raw.length} games from API`);
            } else {
                log.warn(`[Chat ${chatId}] API returned 0 games, falling back to HTML parsing`);
            }
        } catch (err) {
            log.warn(`[Chat ${chatId}] API fetch failed, falling back to HTML parsing:`, err);
        }
    } else {
        log.info(`[Chat ${chatId}] Could not determine city code from URL, using HTML parsing`);
    }

    // Fall back to HTML parsing if API didn't work or returned no games
    if (raw.length === 0) {
        log.info(`[Chat ${chatId}] Fetching games from HTML`);
        raw = await fetchGamesFromHtml(sourceUrl);
        log.info(`[Chat ${chatId}] Fetched ${raw.length} games from HTML`);
    }
    
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
