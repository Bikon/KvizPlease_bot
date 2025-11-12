import * as cheerio from 'cheerio';

import { log } from '../utils/logger.js';
import type { RawGame } from '../types.js';

export function parseQuizPlease(html: string, baseUrl: string): RawGame[] {
    const $ = cheerio.load(html);
    const items: RawGame[] = [];
    
    const scheduleColumns = $('.schedule-column');
    log.info(`[Parser] Found ${scheduleColumns.length} .schedule-column elements`);

    const toAbs = (href: string | undefined) => {
        if (!href) return baseUrl;
        return href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    };

    scheduleColumns.each((_, col) => {
        const idAttr = $(col).attr('id');
        const block = $(col).find('.schedule-block').first();

        const head = block.find('a.schedule-block-head');
        const titleLeft = head.find('.h2.h2-game-card.h2-left').first().text().trim();  // имя до #
        const numberText = head.find('.h2.h2-game-card').eq(1).text().trim();
        const number = numberText.match(/#(\d+)/)?.[1];
        const fullTitle = `${titleLeft} ${numberText}`.trim();

        // gameType: либо в квадратных скобках, либо «Квиз, плиз!»
        let gameType = titleLeft.trim();
        const bracket = gameType.match(/\[.+?].*/);
        if (bracket) gameType = bracket[0].trim();

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

        const externalId = String(idAttr || (url.includes('id=') ? url.split('id=').pop() : `${fullTitle} ${dateText} ${timeText}`));

        if (fullTitle && dateText) {
            items.push({
                externalId,
                title: `${titleLeft} #${number ?? ''}`.trim(),
                gameType: gameType,
                gameNumber: number,
                date: dateText,
                time: timeText,
                venue,
                district: undefined,
                address,
                price,
                difficulty,
                status: '',
                url,
            });
        }
    });

    log.info(`[Parser] Parsed ${items.length} games from HTML (${html.length} chars)`);
    return items;
}
