import { Bot } from 'grammy';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { getFilteredUpcoming, syncGames, groupUpcomingByTypeAndNumber, markProcessed } from './services/gameService.js';
import { postGroupPoll, handlePollAnswer } from './services/pollService.js';

export function createBot() {
  const bot = new Bot(config.token);

  bot.command('start', async (ctx) => {
    await ctx.reply('Привет! Я присылаю опросы по выпускам Квиз Плиз. Команды: /sync, /upcoming, /polls');
  });

  bot.command('sync', async (ctx) => {
    await syncGames();
    await ctx.reply('Синхронизация завершена.');
  });

  bot.command('upcoming', async (ctx) => {
    const games = await getFilteredUpcoming();
    if (!games.length) return ctx.reply('Игр не найдено на выбранный период.');
    const text = games.slice(0, 15).map((g: any, i: number) => {
      const dt = new Date(g.date_time).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      return `${i + 1}. ${g.title}\n${dt} — ${g.venue ?? ''} (${g.district ?? '-'})\n${g.url}`;
    }).join('\n\n');
    await ctx.reply(text, { disable_web_page_preview: true });
  });

  bot.command('polls', async (ctx) => {
    const groups = await groupUpcomingByTypeAndNumber();
    if (!groups.length) return ctx.reply('Нет выпусков с двумя и более датами.');
    let posted = 0;
    for (const g of groups) {
      await postGroupPoll(bot, g);
      await markProcessed(g.groupKey);
      posted++;
      await new Promise(r => setTimeout(r, 500));
    }
    await ctx.reply(`Опросов отправлено: ${posted}`);
  });

  bot.on('poll_answer', async (ctx) => {
    await handlePollAnswer(ctx.update.poll_answer);
  });

  bot.catch((e) => log.error('Bot error:', e));
  return bot;
}
