import cron from 'node-cron';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames, getFilteredUpcoming } from './services/gameService.js';
import type { Bot } from 'grammy';

export function setupScheduler(bot: Bot) {
    const task = cron.schedule(config.cron, async () => {
        try {
            log.info('Cron tick: syncing & maybe posting poll');
            await syncGames();

            // при необходимости можно что-то делать с апдейтом,
            // ниже оставляю только вызов, чтобы не тянуть неиспользуемые импорты
            const games = await getFilteredUpcoming();
            log.info(`Upcoming for ${config.filters.daysAhead}d:`, games.length);
        } catch (e) {
            log.error('Cron job failed:', e);
        }
    }, { timezone: config.tz });

    return task;
}
