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

  await bot.api.setMyCommands([
    { command: 'help', description: 'Список команд' },
    { command: 'select_city', description: 'Выбрать город' },
    { command: 'set_source', description: 'Установить ссылку на расписание вручную' },
    { command: 'sync', description: 'Синхронизировать игры из расписания' },
    { command: 'gamepacks', description: 'Показать пакеты/даты' },
    { command: 'upcoming', description: 'Будущие игры (по пакетам)' },
    { command: 'upcoming_by_dates', description: 'Будущие игры (по датам)' },
    { command: 'poll', description: 'Создать опрос (номер|all)' },
    { command: 'polls_by_date', description: 'Опросы по периодам' },
    { command: 'remove_game_types', description: 'Исключить типы пакетов' },
    { command: 'played', description: 'Отметить как сыгранные' },
    { command: 'unplayed', description: 'Снять отметку сыграно' },
    { command: 'reset', description: 'Очистить все данные чата' },
  ]);
  
  setupScheduler(bot);
  
  // Используем runner для параллельной обработки обновлений из разных чатов
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
