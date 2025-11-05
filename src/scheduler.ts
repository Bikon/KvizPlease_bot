import cron from 'node-cron';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames, getUpcomingGroups } from './services/gameService.js';
import { postGroupPoll } from './services/pollService.js';
import { Bot } from 'grammy';

export function setupScheduler(bot: Bot) {
    const task = cron.schedule(config.cron, async () => {
        try {
            log.info('Cron: sync + post polls per group');
            await syncGames();
            const groups = await getUpcomingGroups();
            for (const g of groups) {
                if (g.items.length >= 2) {
                    await postGroupPoll(bot, g);
                }
            }
        } catch (e) {
            log.error('Cron job failed:', e);
        }
    }, { timezone: config.tz });

    return task;
}
