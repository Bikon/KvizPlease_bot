import { createBot } from './bot.js';
import { setupScheduler } from './scheduler.js';
import { log } from './utils/logger.js';

const bot = createBot();

(async () => {
  await bot.start({ drop_pending_updates: true });
  setupScheduler(bot);
  log.info('Bot started.');
})();
