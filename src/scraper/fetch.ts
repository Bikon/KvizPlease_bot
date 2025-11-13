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
    // В последних версиях puppeteer поле headless либо boolean, либо "shell".
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list'
        ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1400 });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

    const filterButton = await page.$('.schedule-filter-open');
    if (filterButton) {
        await (filterButton as any).click().catch(() => log.warn('Не удалось кликнуть по кнопке открытия фильтра'));
        await sleep(300);
    } else {
        log.warn('Кнопка открытия фильтра не найдена, возможно фильтр раскрыт по умолчанию');
    }

    await page.waitForSelector('.schedule-column', { timeout: 25_000 }).catch(async () => {
        const snapshot = await page.content();
        log.warn('Не удалось найти расписание после загрузки страницы, возвращаем текущий HTML для анализа');
        throw new Error(`Schedule column not found. Page title: ${await page.title()}\n${snapshot.slice(0, 500)}`);
    });

    // Фильтры
    await setCheckbox(page, 'QpGameSearch[format][]', '0'); // офлайн
    for (const v of ['1', '5', '2', '9']) {                 // типы
        await setCheckbox(page, 'QpGameSearch[type][]', v);
    }
    await setCheckbox(page, 'QpGameSearch[status][]', '1'); // есть места

    // Нажимаем «Загрузить ещё» пока видно
    while (true) {
        const moreDiv = await page.$('.load-more-button');
        if (!moreDiv) break;

        const visible = await page.evaluate((el: Element) => {
            const s = window.getComputedStyle(el as HTMLElement);
            return s && s.display !== 'none' && s.visibility !== 'hidden';
        }, moreDiv as any);

        if (!visible) break;

        await (moreDiv as any).click();
        await page.waitForNetworkIdle({ idleTime: 800, timeout: 15_000 }).catch(() => {});
        await sleep(500);
    }

    const html = await page.content();
    await browser.close();
    log.info('HTML grabbed (prefiltered URL) & full list loaded');
    return html;
}
