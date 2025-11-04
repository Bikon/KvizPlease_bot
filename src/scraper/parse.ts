import * as cheerio from 'cheerio';
import { RawGame } from '../types.js';

// Парсим карточки .schedule-column → получаем все поля из HTML
export function parseQuizPlease(html: string, baseUrl: string): RawGame[] {
  const $ = cheerio.load(html);
  const items: RawGame[] = [];

  const toAbs = (href: string | undefined) => {
    if (!href) return baseUrl;
    return href.startsWith('http') ? href : new URL(href, baseUrl).toString();
  };

  $('.schedule-column').each((_, col) => {
    const idAttr = $(col).attr('id');
    const block = $(col).find('.schedule-block').first();

    const head = block.find('a.schedule-block-head');
    const titleLeft = head.find('.h2.h2-game-card.h2-left').first().text().trim();
    const numberText = head.find('.h2.h2-game-card').eq(1).text().trim();
    const number = numberText.match(/#(\d+)/)?.[1];

    // Полная часть до # (учитываем скобки и подзаголовок)
    const titleLine = `${titleLeft} ${numberText}`.trim();
    let name = titleLine.split('#')[0].trim();
    const bracket = name.match(/\[.+?\].*/);
    if (bracket) name = bracket[0].trim();

    // Дата/время/площадка/адрес
    const dateLine = block.find('.block-date-with-language-game').first().text().trim();
    const dateText = dateLine.replace(/\s{2,}/g, ' ').split(',')[0].trim();

    let timeText = '';
    block.find('.schedule-info .techtext').each((__, el) => {
      const t = $(el).text().trim();
      if (/^в\s*\d{1,2}:\d{2}$/i.test(t)) timeText = t;
    });

    const venue = block
      .find('.schedule-block-info-bar')
      .first()
      .clone()
      .children('button')
      .remove()
      .end()
      .text()
      .trim();

    const address = block.find('.techtext-halfwhite').first().text().trim();

    const difficulty =
      block.find('.badge-difficulty__title').first().text().trim() ||
      block.find('.badge-difficulty__icon img').attr('alt') || '';

    const price = block.find('.new-price .price').first().text().trim();

    const href = head.attr('href') || block.find('a:contains("Подробнее")').attr('href') || '';
    const url = toAbs(href);

    const status = $(col).find('.schedule-block-bottom .game-status div').first().text().trim();

    const externalId = String(idAttr || (url.includes('id=') ? url.split('id=').pop() : `${name}#${number ?? ''} ${dateText} ${timeText}`));

    if (name && dateText) {
      items.push({
        externalId,
        title: `${name} #${number ?? ''}`.trim(),
        gameType: name,
        gameNumber: number,
        date: dateText,
        time: timeText,
        venue,
        district: undefined,
        address,
        price,
        difficulty,
        status,
        url,
      });
    }
  });

  return items;
}
