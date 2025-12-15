import { log } from '../utils/logger.js';
import { extractBracketContent, extractGameNumber } from '../utils/patterns.js';
import type { RawGame } from '../types.js';

/**
 * API response types based on the example JSON
 */
interface ApiGame {
    id: string;
    title: string;
    date: string; // Format: "02.01.2023 20:00"
    place: {
        title: string;
        address: string;
        address_ru: string;
        city?: {
            slug: string;
        };
    };
    price: number;
    game_number: string;
    template?: {
        title: string;
        game_level?: string;
    };
    status: number;
    url?: string;
    description?: string;
    quote?: string;
}

interface ApiResponse {
    status: string;
    data: {
        data: ApiGame[];
        pagination: {
            total: number;
            count: number;
            per_page: number;
            current_page: number;
            total_pages: number;
        };
    };
}

/**
 * Parse QuizPlease API response and convert to RawGame format
 */
export function parseQuizPleaseApi(apiResponse: ApiResponse, baseUrl: string): RawGame[] {
    const items: RawGame[] = [];

    if (apiResponse.status !== 'ok' || !apiResponse.data?.data) {
        log.warn('[ParserAPI] Invalid API response structure');
        return items;
    }

    const games = apiResponse.data.data;
    log.info(`[ParserAPI] Processing ${games.length} games from API`);

    for (const game of games) {
        try {
            // Extract title and game number
            const titleLeft = game.title.trim();
            const number = game.game_number ? String(game.game_number) : extractGameNumber(titleLeft);
            const fullTitle = number ? `${titleLeft} #${number}` : titleLeft;

            // Extract game type (either from brackets or default to "Квиз, плиз!")
            let gameType = titleLeft.trim();
            const bracketContent = extractBracketContent(gameType);
            if (bracketContent) {
                gameType = bracketContent;
            } else if (!gameType.toLowerCase().includes('квиз')) {
                // If no brackets and doesn't contain "квиз", use template title if available
                gameType = game.template?.title || gameType;
            }

            // Parse date and time from "02.01.2023 20:00" format
            const dateTimeMatch = game.date.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
            if (!dateTimeMatch) {
                log.warn(`[ParserAPI] Could not parse date: ${game.date}`);
                continue;
            }

            const [, day, month, year, hour, minute] = dateTimeMatch;
            const dateText = `${day}.${month}.${year}`;
            const timeText = `в ${hour}:${minute}`;

            // Extract venue and address
            const venue = game.place?.title || '';
            const address = game.place?.address_ru || game.place?.address || '';

            // Extract price
            const price = game.price ? `${game.price} ₽` : '';

            // Extract difficulty from template game_level
            const difficulty = game.template?.game_level || '';

            // Build URL - try to construct from game ID or use baseUrl
            let url = baseUrl;
            if (game.id) {
                // Try to construct URL like: https://{city}.quizplease.ru/game/{id}
                const citySlug = game.place?.city?.slug || 'spb';
                url = `https://${citySlug}.quizplease.ru/game/${game.id}`;
            } else if (game.url) {
                url = game.url;
            }

            // Use game ID as externalId
            const externalId = game.id || `${fullTitle} ${dateText} ${timeText}`.trim();

            // Status mapping (4 = active, etc.)
            const status = game.status === 4 ? '' : String(game.status);

            items.push({
                externalId,
                title: fullTitle,
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
        } catch (err) {
            log.warn(`[ParserAPI] Failed to parse game ${game.id}:`, err);
        }
    }

    log.info(`[ParserAPI] Parsed ${items.length} games from API`);
    return items;
}

