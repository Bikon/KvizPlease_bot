import puppeteer from 'puppeteer';
import { log } from '../utils/logger.js';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function grabPageHtmlWithFilters(url: string) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });

    await page.goto(url, { waitUntil: 'networkidle2' });

    // Жмём "Загрузить ещё" пока появляются новые карточки
    while (true) {
        const btn = await page.$('.load-more-button');
        if (!btn) break;

        const before = await page.$$eval('.schedule-column', els => els.length);

        await btn.click().catch(() => {});
        // ждём прироста количества карточек
        await page
            .waitForFunction(
                (sel, n) => document.querySelectorAll(sel).length > n,
                { timeout: 15000 },
                '.schedule-column',
                before
            )
            .catch(() => null);

        const after = await page.$$eval('.schedule-column', els => els.length);
        if (after <= before) {
            await sleep(600);
            const after2 = await page.$$eval('.schedule-column', els => els.length);
            if (after2 <= before) break;
        }
    }

    const html = await page.content();
    await browser.close();
    log.info('HTML grabbed (prefiltered URL) & full list loaded');
    return html;
}
