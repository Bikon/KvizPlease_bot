import puppeteer, { type Page } from 'puppeteer';

import { log } from '../utils/logger.js';

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

// Кликаем чекбоксы по name=value, если присутствуют на странице
async function setCheckbox(page: Page, name: string, value: string) {
    const sel = `input[type="checkbox"][name="${name}"][value="${value}"]`;
    try {
        const handle = await page.waitForSelector(sel, { timeout: 5_000, visible: true }).catch(() => null);
        if (!handle) {
            log.warn(`Checkbox не найден: ${sel}`);
            return;
        }

        const checked = await page.evaluate((el: HTMLInputElement) => el.checked, handle as any);
        if (!checked) {
            // Проверим, что элемент действительно кликабелен
            const isClickable = await page.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }, handle as any);

            if (!isClickable) {
                log.warn(`Checkbox не кликабелен: ${sel}`);
                return;
            }

            await (handle as any).click();
            await sleep(150);
        }
    } catch (e) {
        log.warn(`Ошибка при клике на чекбокс ${sel}:`, e);
    }
}

export async function grabPageHtmlWithFilters(url: string) {
    // В последних версиях puppeteer поле headless либо boolean, либо "shell".
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1400 });

    await page.goto(url, { waitUntil: 'networkidle2' });

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
