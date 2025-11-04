import puppeteer from 'puppeteer';
import { log } from '../utils/logger.js';

// Кликаем чекбоксы по name=value, если они присутствуют на странице
async function setCheckbox(page: puppeteer.Page, name: string, value: string) {
  const handle = await page.$(`input[type="checkbox"][name="${name}"][value="${value}"]`);
  if (handle) {
    const checked = await page.evaluate((el: HTMLInputElement) => el.checked, handle);
    if (!checked) {
      await handle.click();
      await page.waitForTimeout(150);
    }
  }
}

export async function grabPageHtmlWithFilters(url: string) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1400 });

  await page.goto(url, { waitUntil: 'networkidle2' });

  // Формат: офлайн
  await setCheckbox(page, 'QpGameSearch[format][]', '0');
  // Типы: классика, кино-муз, тематические, тематические кино-муз
  for (const v of ['1','5','2','9']) {
    await setCheckbox(page, 'QpGameSearch[type][]', v);
  }
  // Статус: есть места
  await setCheckbox(page, 'QpGameSearch[status][]', '1');

  // "Загрузить ещё"
  while (true) {
    const moreDiv = await page.$('.load-more-button');
    if (!moreDiv) break;
    const isVisible = await page.evaluate(el => {
      const s = window.getComputedStyle(el as any);
      return s && s.display !== 'none' && s.visibility !== 'hidden';
    }, moreDiv);
    if (!isVisible) break;
    await moreDiv.click();
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const html = await page.content();
  await browser.close();
  log.info('HTML grabbed with filters & full list loaded');
  return html;
}
