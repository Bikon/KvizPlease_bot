import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

import { log } from '../utils/logger.js';

puppeteer.use(StealthPlugin());

const ANTI_BOT_PATTERNS = [
    /подтвердите.*(не\s*робот|robot)/i,
    /captcha/i,
    /cloudflare/i,
];

const BROWSER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-notifications',
    '--disable-blink-features=AutomationControlled',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--lang=ru-RU,ru',
];

const NAV_TIMEOUT_MS = 90_000;
const PAGE_TIMEOUT_MS = 45_000;
const BROWSER_TIMEOUT_MS = 120_000;
const MAX_BROWSER_ATTEMPTS = 3;
const MAX_SCROLL_ITERATIONS = 120;
const SCROLL_DELAY_MS = 800;
const HTTP_TIMEOUT_MS = 25_000;
const HTTP_RETRIES = 2;

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUserAgent(): string {
    return USER_AGENTS[crypto.randomInt(0, USER_AGENTS.length)];
}

function containsChallenge(html: string): boolean {
    return ANTI_BOT_PATTERNS.some(pattern => pattern.test(html));
}

async function fetchViaHttp(url: string): Promise<string | null> {
    let controller: AbortController | undefined;
    for (let attempt = 1; attempt <= HTTP_RETRIES; attempt++) {
        try {
            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), HTTP_TIMEOUT_MS);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': randomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': url,
                },
            });
            clearTimeout(timeout);

            if (!res.ok) {
                log.warn(`[Scraper] HTTP attempt ${attempt} failed with status ${res.status}`);
                await delay(500 * attempt);
                continue;
            }

            const html = await res.text();
            if (containsChallenge(html)) {
                log.warn('[Scraper] HTTP response looks like an anti-bot challenge, switching to browser mode');
                return null;
            }

            // Quick structural check: if the HTML doesn't contain either legacy schedule columns
            // or new game-card layout, fall back to browser rendering (likely JS-driven SPA shell).
            try {
                const $ = cheerio.load(html);
                const hasScheduleColumns = $('.schedule-column').length > 0;
                const hasGameCards = $('.game-card__wrap').length > 0 || $('.game-card').length > 0;

                if (!hasScheduleColumns && !hasGameCards) {
                    log.warn('[Scraper] HTTP HTML has no .schedule-column or .game-card* elements, switching to browser mode');
                    return null;
                }
            } catch (e) {
                log.warn('[Scraper] Failed to inspect HTTP HTML with cheerio, using raw HTML', e);
            }

            log.info('[Scraper] HTTP fetch succeeded with usable schedule layout');
            return html;
        } catch (err) {
            log.warn(`[Scraper] HTTP attempt ${attempt} failed`, err);
            await delay(500 * attempt);
        } finally {
            controller?.abort();
        }
    }
    return null;
}

async function autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await new Promise<void>(resolve => {
            let totalHeight = 0;
            const distance = 400;
            const timer = window.setInterval(() => {
                const { scrollHeight } = document.body;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight - 10) {
                    window.clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
}

async function clickLoadMore(page: Page): Promise<boolean> {
    return page
        .evaluate(() => {
            const selectors = [
                '.load-more-button',
                '.schedule-more__button',
                '.schedule-more button',
                '.schedule-more a',
            ];

            const buttons = selectors
                .map(selector => document.querySelector<HTMLElement>(selector))
                .filter((btn): btn is HTMLElement => !!btn && btn.offsetParent !== null);

            if (!buttons.length) {
                const fallback = Array.from(document.querySelectorAll<HTMLElement>('button, a')).find(node => {
                    const text = node.textContent?.toLowerCase() ?? '';
                    return text.includes('загрузить ещё') || text.includes('показать ещё') || text.includes('показать больше');
                });
                if (fallback) {
                    fallback.scrollIntoView({ block: 'center', behavior: 'auto' });
                    fallback.click();
                    return true;
                }
                return false;
            }

            const btn = buttons[0];
            btn.scrollIntoView({ block: 'center', behavior: 'auto' });
            btn.click();
            return true;
        })
        .catch(err => {
            log.warn('[Scraper] Failed to trigger load-more button', err);
            return false;
        });
}

async function ensureScheduleLoaded(page: Page): Promise<void> {
    // Support both legacy schedule layout and new card-based layout.
    await page.waitForSelector('.schedule-column, .game-card__wrap, .game-card', { timeout: 30_000 });

    let previousCount = await page.$$eval('.schedule-column, .game-card__wrap, .game-card', elements => elements.length);
    let stagnantIterations = 0;

    for (let iteration = 0; iteration < MAX_SCROLL_ITERATIONS; iteration++) {
        const clicked = await clickLoadMore(page);
        if (!clicked) {
            await autoScroll(page);
        }

        await page.waitForNetworkIdle({ idleTime: 800, timeout: 25_000 }).catch(() => {});
        await delay(SCROLL_DELAY_MS);

        const currentCount = await page.$$eval('.schedule-column, .game-card__wrap, .game-card', elements => elements.length);
        if (currentCount <= previousCount) {
            stagnantIterations += 1;
            if (stagnantIterations >= 4) {
                log.info('[Scraper] No new schedule columns detected, stopping scroll loop');
                break;
            }
        } else {
            stagnantIterations = 0;
            log.info(`[Scraper] schedule-column count increased: ${currentCount}`);
        }
        previousCount = currentCount;
    }
}

async function gotoWithFallback(page: Page, targetUrl: string): Promise<boolean> {
    const strategies: Array<'domcontentloaded' | 'load' | 'networkidle2'> = ['domcontentloaded', 'load', 'networkidle2'];
    for (const strategy of strategies) {
        try {
            log.info(`[Scraper] Navigating to ${targetUrl} (waitUntil=${strategy})`);
            await page.goto(targetUrl, { waitUntil: strategy, timeout: NAV_TIMEOUT_MS });
            return true;
        } catch (err) {
            log.warn(`[Scraper] Navigation failed for ${targetUrl} with waitUntil=${strategy}`, err);
            await delay(1_000);
        }
    }
    return false;
}

async function fetchViaBrowser(url: string): Promise<string> {
    let browser: Browser | null = null;

    for (let attempt = 1; attempt <= MAX_BROWSER_ATTEMPTS; attempt++) {
        try {
            log.info(`[Scraper] Browser fetch attempt ${attempt}`);
            browser = await puppeteer.launch({
                headless: 'shell',
                timeout: BROWSER_TIMEOUT_MS,
                args: BROWSER_LAUNCH_ARGS,
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 1400 });
            await page.setUserAgent(randomUserAgent());
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            });
            page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
            page.setDefaultTimeout(PAGE_TIMEOUT_MS);

            const navigated = await gotoWithFallback(page, url);
            if (!navigated) {
                throw new Error('Navigation failed for all waitUntil strategies');
            }

            await ensureScheduleLoaded(page);

            const html = await page.content();
            if (containsChallenge(html)) {
                throw new Error('Received anti-bot challenge page even after browser navigation');
            }

            log.info('[Scraper] Browser fetch succeeded');
            return html;
        } catch (err) {
            log.error(`[Scraper] Browser attempt ${attempt} failed`, err);
            if (attempt === MAX_BROWSER_ATTEMPTS) throw err;
            await delay(1_500 * attempt);
        } finally {
            await browser?.close().catch(() => {});
            browser = null;
        }
    }

    throw new Error('Unable to fetch schedule via browser');
}

export async function grabPageHtmlWithFilters(url: string): Promise<string> {
    const httpHtml = await fetchViaHttp(url);
    if (httpHtml) {
        return httpHtml;
    }
    return fetchViaBrowser(url);
}
