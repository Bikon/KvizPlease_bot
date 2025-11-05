import { Bot } from 'grammy';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { getFilteredUpcoming, syncGames } from './services/gameService.js';
import * as pollSvc from './services/pollService.js';

// Универсальный хелпер «со статусом»
async function withStatus<T>(
    ctx: any,
    startText: string,
    task: () => Promise<T>,
    formatOk: (result: T, ms: number) => string,
    formatFail: (err: unknown) => string = (e) =>
        `❌ Ошибка: ${e instanceof Error ? e.message : String(e)}`
) {
    const started = Date.now();
    const msg = await ctx.reply(startText);

    // «Печатает…» каждые 4 секунды — чтобы было видно, что бот живёт
    const keepTyping = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
    }, 4000);

    try {
        const result = await task();
        const ms = Date.now() - started;
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, formatOk(result, ms));
    } catch (e) {
        log.error('Bot error:', e);
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, formatFail(e));
    } finally {
        clearInterval(keepTyping);
    }
}

// Вспомогалка для ответов без секунд, в МСК
const dtFmt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
});

// Группировка «на лету» по group_key (на случай, если хочется увидеть, что в БД)
function groupByGroupKey(rows: any[]) {
    const map = new Map<
        string,
        { groupKey: string; name: string; number: string; items: any[] }
    >();
    for (const r of rows) {
        const key: string = r.group_key ?? '';
        if (!key) continue;
        if (!map.has(key)) {
            // Попробуем вытащить имя и номер из title или group_key
            // Примеры: "[music party] 2000-е #7", "Квиз, плиз! #1213"
            const title: string = r.title ?? key;
            const m =
                /\s*(.*?)\s*#\s*(\d+)\s*$/i.exec(title) || // из title
                /\s*(.*?)#\s*(\d+)\s*$/i.exec(key);        // из ключа
            const name = (m?.[1] ?? title).trim().replace(/\s+$/,'');
            const number = (m?.[2] ?? '').trim();
            map.set(key, { groupKey: key, name, number, items: [] });
        }
        map.get(key)!.items.push(r);
    }
    return Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'ru') || Number(a.number) - Number(b.number)
    );
}

export function createBot() {
    const bot = new Bot(config.token);

    bot.command('start', async (ctx) => {
        await ctx.reply(
            'Привет! Я буду раз в неделю присылать опрос по играм Квиз Плиз.\n' +
            'Команды:\n' +
            '• /sync — синхронизация расписания\n' +
            '• /upcoming [N|all] — ближайшие даты (по умолчанию 50)\n' +
            '• /groups — список выпусков (группы и количество дат)\n' +
            '• /poll — опубликовать опрос'
        );
    });

    // /sync со статус-сообщением
    bot.command('sync', async (ctx) => {
        await withStatus(
            ctx,
            '🔄 Синхронизирую расписание… это может занять 30–90 секунд.',
            async () => {
                await syncGames();
                return null;
            },
            () => '✅ Синхронизация завершена.'
        );
    });

    // /upcoming с лимитом и форматом без секунд
    bot.command('upcoming', async (ctx) => {
        const arg = (ctx.match || '').trim();
        const limit =
            arg.toLowerCase() === 'all'
                ? Number.POSITIVE_INFINITY
                : /^\d+$/.test(arg)
                    ? Number(arg)
                    : 50; // дефолт

        const games = await getFilteredUpcoming();
        if (!games.length) return ctx.reply('Игр не найдено на выбранный период.');

        const text = games
            .slice(0, limit)
            .map((g: any, i: number) => {
                const when = dtFmt.format(new Date(g.date_time));
                const venue = g.venue ? ` — ${g.venue}` : '';
                return `${i + 1}. ${g.title}\n${when}${venue} (${g.district ?? '-'})\n${g.url}`;
            })
            .join('\n\n');

        await ctx.reply(text);
    });

    // /groups — посмотреть сгруппированный список выпусков и количество дат
    bot.command('groups', async (ctx) => {
        const games = await getFilteredUpcoming();
        if (!games.length) return ctx.reply('Игр не найдено на выбранный период.');

        const groups = groupByGroupKey(games);
        if (!groups.length) return ctx.reply('Группы не найдены.');

        const text = groups
            .map((g, i) => `${i + 1}. ${g.name} #${g.number} — дат: ${g.items.length}`)
            .join('\n');

        await ctx.reply(text);
    });

    // /poll со статус-сообщением
    bot.command('poll', async (ctx) => {
        await withStatus(
            ctx,
            '🗳 Формирую опрос… пожалуйста, подождите.',
            async () => {
                const games = await getFilteredUpcoming();
                // Если в сервисе есть групповой постинг — предпочтем его
                if ('postGroupPoll' in pollSvc && typeof (pollSvc as any).postGroupPoll === 'function') {
                    // Сформируем группы и отправим только те, у которых ≥ 2 дат
                    const groups = groupByGroupKey(games).filter((g) => g.items.length >= 2);
                    if (!groups.length) return false;
                    // Отправим опрос по каждой группе по очереди
                    for (const g of groups) {
                        await (pollSvc as any).postGroupPoll(bot, g);
                    }
                    return true;
                }
                // Иначе — старый общий опрос (если реализован)
                if ('postWeeklyPoll' in pollSvc && typeof (pollSvc as any).postWeeklyPoll === 'function') {
                    const msg = await (pollSvc as any).postWeeklyPoll(bot, games);
                    return Boolean(msg);
                }
                throw new Error('Не найдена функция публикации опроса (postGroupPoll / postWeeklyPoll).');
            },
            (ok) =>
                ok
                    ? '✅ Опрос(ы) опубликован(ы).'
                    : 'ℹ️ Нет подходящих данных для опросов (нужно ≥ 2 даты на выпуск).'
        );
    });

    // Сохранение голосов
    bot.on('poll_answer', async (ctx) => {
        if ('handlePollAnswer' in pollSvc && typeof (pollSvc as any).handlePollAnswer === 'function') {
            await (pollSvc as any).handlePollAnswer(ctx.update.poll_answer);
        }
    });

    bot.catch((e) => log.error('Bot error:', e));
    return bot;
}
