import * as cheerio from 'cheerio';

import { log } from '../utils/logger.js';
import { extractBracketContent, extractGameNumber, isTimeFormat } from '../utils/patterns.js';
import type { RawGame } from '../types.js';

/**
 * New parser for updated QuizPlease layout that uses `.game-card__wrap` / `.game-card` cards.
 */
export function parseQuizPleaseV2(html: string, baseUrl: string): RawGame[] {
    const $ = cheerio.load(html);
    const items: RawGame[] = [];

    const toAbs = (href: string | undefined) => {
        if (!href) return baseUrl;
        return href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    };

    // Select actual game cards (not background wrappers)
    const cards = $('.game-card').has('.game-card__name-wrapper');
    log.info(`[ParserV2] Found ${cards.length} .game-card elements with .game-card__name-wrapper`);

    cards.each((_, card) => {
        const $card = $(card);

        const nameNodes = $card.find('.game-card__name-wrapper .game-card__name');
        const titleLeft = nameNodes.first().text().trim();
        const numberText = nameNodes.eq(1).text().trim();
        const number = extractGameNumber(numberText);
        const fullTitle = `${titleLeft} ${numberText}`.trim();

        // gameType: либо в квадратных скобках, либо «Квиз, плиз!»
        let gameType = titleLeft.trim();
        const bracketContent = extractBracketContent(gameType);
        if (bracketContent) gameType = bracketContent;

        const dateText = $card.find('.game-card__date').first().text().trim();

        let timeText = '';
        $card.find('.game-card__location-wrapper .game-card__location-text').each((__, el) => {
            const raw = $(el).text().trim();
            // Normalize "at 19:30" to "в 19:30" so isTimeFormat can detect it
            const normalized = raw.replace(/^at\s*/i, 'в ');
            if (isTimeFormat(normalized)) {
                timeText = normalized;
            }
        });

        const venueTitle = $card.find('.game-card__location-text__title').first().clone();
        venueTitle.find('button').remove();
        const venue = venueTitle.text().trim();

        const addressNode = $card.find('.game-card__location-text__subtitle').first().clone();
        addressNode.find('button').remove();
        const address = addressNode.text().trim();

        const difficulty =
            $card.find('.badge-difficulty__title').first().text().trim() ||
            $card.find('.badge-difficulty__icon img').attr('alt') ||
            '';

        const price = $card.find('.game-card__cost-title').first().text().trim();

        const href =
            $card.find('.game-card__name-wrapper a.game-card__name').attr('href') ||
            $card.find('.game-card__buttons a[href]').first().attr('href') ||
            '';
        const url = toAbs(href);

        // Try to extract stable external id from /game/{uuid}
        let externalId = '';
        const gameMatch = url.match(/\/game\/([^/?#]+)/);
        if (gameMatch?.[1]) {
            externalId = gameMatch[1];
        } else if (url.includes('id=')) {
            externalId = String(url.split('id=').pop());
        } else {
            externalId = `${fullTitle} ${dateText} ${timeText}`.trim();
        }

        const status = $card.find('.game-card__days').first().text().trim();

        if (fullTitle && dateText) {
            items.push({
                externalId,
                title: `${titleLeft} #${number ?? ''}`.trim(),
                gameType,
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

    log.info(`[ParserV2] Parsed ${items.length} games from HTML (${html.length} chars)`);
    return items;
}
