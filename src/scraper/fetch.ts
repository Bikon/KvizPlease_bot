import puppeteer from 'puppeteer-extra';
import type { Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { log } from '../utils/logger.js';

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

// Кликаем чекбоксы по name=value, если присутствуют на странице
async function setCheckbox(page: Page, name: string, value: string) {
    const sel = `input[type="checkbox"][name="${name}"][value="${value}"]`;
    try {
        const handle = await page.waitForSelector(sel, { timeout: 5_000 }).catch(() => null);
        if (!handle) {
            log.warn(`Checkbox не найден: ${sel}`);
            return;
        }

        const wasChecked = await page.evaluate((el: HTMLInputElement) => el.checked, handle as any);
        if (!wasChecked) {
            const success = await page.evaluate((selector: string) => {
                const el = document.querySelector<HTMLInputElement>(selector);
                if (!el) return false;
                if (el.checked) return true;

                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return el.checked;
            }, sel);

            if (!success) {
                await (handle as any).click().catch(() => log.warn(`Не удалось кликнуть по чекбоксу: ${sel}`));
            }
            await sleep(250);
        }
    } catch (e) {
        log.warn(`Ошибка при клике на чекбокс ${sel}:`, e);
    }
}

puppeteer.use(StealthPlugin());

export async function grabPageHtmlWithFilters(url: string) {
    const targetOrigin = (() => {
        try {
            return new URL(url).origin;
        } catch {
            return 'https://quizplease.ru';
        }
    })();

    async function warmup(page: Page) {
        const warmupUrls = Array.from(
            new Set([
                targetOrigin,
                `${targetOrigin}/schedule`,
            ])
        );

        for (const warmUrl of warmupUrls) {
            try {
                log.info(`[Scraper] Warmup navigation: ${warmUrl}`);
                await page.goto(warmUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await sleep(800);
            } catch (err) {
                log.warn(`[Scraper] Warmup failed for ${warmUrl}`, err);
            }
        }
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
        ],
    });

    let lastError: unknown;
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1400 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        });

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (attempt > 1) {
                    await warmup(page);
                }

                log.info(`[Scraper] Loading schedule page (attempt ${attempt})`);
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

                // Иногда фильтр уже раскрыт, но если нет — пробуем кликнуть через evaluate, чтобы избежать разрыва контекста
                const filterOpened = await page
                    .evaluate(() => {
                        const btn = document.querySelector<HTMLElement>('.schedule-filter-open');
                        if (!btn) return false;
                        btn.click();
                        return true;
                    })
                    .catch((err) => {
                        log.warn('[Scraper] Ошибка при попытке раскрыть фильтр', err);
                        return false;
                    });

                if (filterOpened) {
                    await sleep(400);
                } else {
                    log.warn('[Scraper] Кнопка открытия фильтра не найдена, возможно фильтр раскрыт по умолчанию');
                }

                await page
                    .waitForSelector('.schedule-column', { timeout: 30_000, visible: true })
                    .catch(async () => {
                        const snapshot = await page.content();
                        throw new Error(
                            `Schedule column not found. Page title: ${await page.title()}\n${snapshot.slice(0, 500)}`
                        );
                    });

                // Фильтры
                await setCheckbox(page, 'QpGameSearch[format][]', '0'); // офлайн
                for (const v of ['1', '5', '2', '9']) {                 // типы
                    await setCheckbox(page, 'QpGameSearch[type][]', v);
                }
                await setCheckbox(page, 'QpGameSearch[status][]', '1'); // есть места

                // Нажимаем «Загрузить ещё» пока появляются новые карточки
                const loadMoreResult = await page
                    .evaluate(async () => {
                        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

                        const pickButton = (): HTMLElement | null => {
                            const selectors = [
                                '.load-more-button',
                                '.schedule-more__button',
                                '.schedule-more button',
                                '.schedule-more a',
                            ];
                            for (const sel of selectors) {
                                const candidate = document.querySelector<HTMLElement>(sel);
                                if (candidate && candidate.offsetParent !== null) {
                                    return candidate;
                                }
                            }
                            const fallback = Array.from(document.querySelectorAll<HTMLElement>('button, a')).find(
                                (node) => {
                                    const text = node.textContent?.toLowerCase() ?? '';
                                    return (
                                        text.includes('загрузить ещё') ||
                                        text.includes('показать ещё') ||
                                        text.includes('показать больше')
                                    );
                                }
                            );
                            return fallback ?? null;
                        };

                        let prevCount = document.querySelectorAll('.schedule-column').length;
                        let stagnantIterations = 0;
                        let iterations = 0;
                        for (; iterations < 60; iterations++) {
                            const btn = pickButton();
                            if (!btn) break;

                            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                            btn.click();

                            await delay(1500);
                            window.scrollTo(0, document.body.scrollHeight);
                            await delay(400);

                            const current = document.querySelectorAll('.schedule-column').length;
                            if (current <= prevCount) {
                                stagnantIterations += 1;
                                if (stagnantIterations >= 3) {
                                    break;
                                }
                            } else {
                                stagnantIterations = 0;
                            }
                            prevCount = current;
                        }

                        return { count: prevCount, iterations };
                    })
                    .catch((err) => {
                        log.warn('[Scraper] Ошибка при загрузке дополнительных карточек', err);
                        return null;
                    });

                if (loadMoreResult) {
                    log.info(
                        `[Scraper] Итоговое количество карточек: ${loadMoreResult.count} (итераций загрузки: ${loadMoreResult.iterations})`
                    );
                }

                const html = await page.content();
                log.info('[Scraper] HTML grabbed (prefiltered URL) & full list loaded');
                return html;
            } catch (err) {
                lastError = err;
                log.warn(`[Scraper] Ошибка на попытке ${attempt}:`, err);
                if (attempt === maxAttempts) break;
                await sleep(1_500);
            }
        }
        throw lastError ?? new Error('grabPageHtmlWithFilters failed without explicit error');
    } finally {
        await browser.close();
    }
}
