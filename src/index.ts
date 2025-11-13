import { run } from '@grammyjs/runner';

import { createBot } from './bot.js';
import { setupScheduler } from './scheduler.js';
import { log } from './utils/logger.js';

const bot = createBot();

(async () => {
  // Verify bot connection
  try {
    const me = await bot.api.getMe();
    log.info(`Bot connected successfully: @${me.username} (${me.first_name})`);
  } catch (e) {
    log.error('Failed to connect to Telegram API:', e);
    process.exit(1);
  }

  // Delete old commands first to clear cache
  try {
    await bot.api.deleteMyCommands();
    log.info('Old commands cleared');
  } catch (e) {
    log.warn('Could not clear old commands:', e);
  }

  await bot.api.setMyCommands([
    { command: 'help', description: 'Список команд' },
    { command: 'select_city', description: 'Выбрать город' },
    { command: 'set_source', description: 'Установить ссылку на расписание вручную' },
    { command: 'sync', description: 'Синхронизировать игры из расписания' },
    { command: 'game_packs_management', description: 'Пакеты и типы игр' },
    { command: 'upcoming', description: 'Будущие игры (по пакетам)' },
    { command: 'upcoming_by_dates', description: 'Будущие игры (по датам)' },
    { command: 'polls', description: 'Создать опросы' },
    { command: 'played', description: 'Управление статусом игр' },
    { command: 'team_info', description: 'Информация о команде' },
    { command: 'register_from_polls', description: 'Регистрация по опросам' },
    { command: 'registered', description: 'Управление регистрациями' },
    { command: 'reset', description: 'Очистить все данные чата' },
  ]);
  
  setupScheduler(bot);
  
  // Use runner for concurrent update processing
  const runner = run(bot, {
    runner: {
      fetch: {
        allowed_updates: ['message', 'callback_query', 'poll_answer'],
      },
    },
  });
  
  log.info('Bot started with concurrent runner (max 500 parallel updates)');
  
  // Graceful shutdown
  const stopRunner = () => {
    log.info('Stopping bot runner...');
    runner.stop();
  };
  
  process.once('SIGINT', stopRunner);
  process.once('SIGTERM', stopRunner);
})();
