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
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-blink-features=AutomationControlled', // Скрываем признаки автоматизации
        ],
    });
    const page = await browser.newPage();
    
    // Устанавливаем реальный User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Устанавливаем языковые заголовки
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    });
    
    // Скрываем webdriver и другие признаки автоматизации
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        
        // Добавляем реалистичные плагины
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        // Эмулируем языки
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ru-RU', 'ru', 'en-US', 'en'],
        });
    });
    
    await page.setViewport({ width: 1280, height: 1400 });

    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Проверяем, не попали ли мы на страницу с капчей
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('запросы с вашего устройства похожи на автоматические') || 
        pageText.includes('Подтвердите, что запросы отправляли вы')) {
        log.error('[Scraper] Detected CAPTCHA page! Bot detection triggered.');
        await browser.close();
        throw new Error('Website blocked the scraper with CAPTCHA');
    }
    
    // Небольшая задержка для рендеринга JavaScript
    await sleep(2000);

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
