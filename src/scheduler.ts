import cron from 'node-cron';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames, groupUpcomingByTypeAndNumber, markProcessed } from './services/gameService.js';
import { postGroupPoll } from './services/pollService.js';
import { Bot } from 'grammy';

export function setupScheduler(bot: Bot) {
  const task = cron.schedule(config.cron, async () => {
    try {
      log.info('Cron tick: sync & post grouped polls');
      await syncGames();
      const groups = await groupUpcomingByTypeAndNumber();
      for (const g of groups) {
        await postGroupPoll(bot, g);
        await markProcessed(g.groupKey);
        await new Promise(r => setTimeout(r, 500));
      }
      log.info(`Posted polls for groups: ${groups.length}`);
    } catch (e) {
      log.error('Cron job failed:', e);
    }
  }, { timezone: config.tz });

  return task;
}
