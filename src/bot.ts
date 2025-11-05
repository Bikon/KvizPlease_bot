import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames, getFilteredUpcoming, getUpcomingGroups } from './services/gameService.js';
import { postGroupPoll, handlePollAnswer } from './services/pollService.js';
import { excludeGroup, markGroupPlayed, listExcludedTypes, excludeType, unexcludeType, unexcludeGroup } from './db/repositories.js';

const CB = {
    GROUP_PLAYED: 'gp:',       // gp:<groupKey>
    GROUP_EXCLUDE: 'ge:',
    GROUP_UNEXCLUDE: 'gu:',
    TYPE_EXCLUDE: 'te:',       // te:<typeName>
    TYPE_UNEXCLUDE: 'tu:',     // tu:<typeName>
};

function kbForGroup(groupKey: string, isExcluded = false) {
    const kb = new InlineKeyboard()
        .text('✅ Сыграли', CB.GROUP_PLAYED + groupKey).row();

    if (isExcluded) {
        kb.text('♻️ Вернуть выпуск', CB.GROUP_UNEXCLUDE + groupKey);
    } else {
        kb.text('🗑️ Исключить выпуск', CB.GROUP_EXCLUDE + groupKey);
    }
    return kb;
}

function parseLimit(text: string | undefined, def = 15) {
    const n = text ? parseInt(text.trim(), 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(n, 50); // хардлимит, чтобы точно не упираться в 4096
}

// Формат одной игры (ровно как у вас раньше)
function formatGame(g: any, idx: number) {
    const dt = new Date(g.date_time);
    const pad = (x: number) => String(x).padStart(2, '0');
    const dd = pad(dt.getDate());
    const mm = pad(dt.getMonth() + 1);
    const yyyy = dt.getFullYear();
    const hh = pad(dt.getHours());
    const mi = pad(dt.getMinutes());
    const place = g.venue ?? '-';
    const url = g.url ?? '';

    return `${idx}. ${g.title}\n${dd}.${mm}.${yyyy}, ${hh}:${mi}:00 — ${place} (-)\n${url}`;
}

// Собираем текст порции и возвращаем nextOffset (если есть ещё)
function buildUpcomingChunk(
    games: any[],
    offset: number,
    limit: number
): { text: string; nextOffset: number | null } {
    const end = Math.min(offset + limit, games.length);
    const parts: string[] = [];

    for (let i = offset; i < end; i++) {
        parts.push(formatGame(games[i], i + 1)); // сквозная нумерация
    }

    const text = parts.join('\n\n');
    const nextOffset = end < games.length ? end : null;

    // На всякий случай защитимся от лимита 4096 символов:
    if (text.length <= 3800) return { text, nextOffset };

    // Если вдруг слишком длинно даже для N — уменьшим порцию динамически
    let safeEnd = end;
    while (safeEnd > offset + 1) {
        const t = parts.slice(0, safeEnd - offset).join('\n\n');
        if (t.length <= 3800) return { text: t, nextOffset: safeEnd < games.length ? safeEnd : null };
        safeEnd--;
    }
    // упадём на 1 элемент — точно поместится
    return { text: parts[0], nextOffset: offset + 1 < games.length ? offset + 1 : null };
}

// Клавиатура "Показать ещё"
function moreKeyboard(nextOffset: number, limit: number) {
    const kb = new InlineKeyboard();
    kb.text('Показать ещё', `more:upcoming:${nextOffset}:${limit}`);
    return kb;
}

export function createBot() {
    const bot = new Bot(config.token);

    bot.command('start', async (ctx) => {
        await ctx.reply('Привет! Я буду синхронизировать игры и формировать опросы.\nКоманды: /sync, /upcoming, /groups, /poll <N>, /types');
    });

    // Инфо-уведомление сразу, чтобы не казалось, что «зависло»
    bot.command('sync', async (ctx) => {
        await ctx.reply('🔄 Синхронизация началась, это может занять до пары минут…');
        await syncGames();
        await ctx.reply('✅ Синхронизация завершена.');
    });

    bot.command('upcoming', async (ctx) => {
        try {
            const arg = (ctx.match as string | undefined) ?? '';
            const limit = parseLimit(arg, 15);

            await ctx.reply(arg?.trim()
                ? `Будущие ${limit} игр`
                : 'Будущие игры');

            const games = await getFilteredUpcoming(); // уже учитывает фильтры проекта
            if (!games.length) {
                await ctx.reply('Пока ничего нет.');
                return;
            }

            const { text, nextOffset } = buildUpcomingChunk(games, 0, limit);
            if (nextOffset !== null) {
                await ctx.reply(text, { reply_markup: moreKeyboard(nextOffset, limit) });
            } else {
                await ctx.reply(text);
            }
        } catch (e) {
            log.error('[upcoming] failed:', e);
            await ctx.reply('Не удалось получить список ближайших игр :(');
        }
    });

    // Обработка "Показать ещё"
    bot.callbackQuery(/^more:upcoming:(\d+):(\d+)$/, async (ctx) => {
        try {
            const [, offStr, limStr] = ctx.match!;
            const offset = parseInt(offStr, 10);
            const limit = parseInt(limStr, 10);

            const games = await getFilteredUpcoming();
            if (offset >= games.length) {
                await ctx.answerCallbackQuery({ text: 'Больше игр нет' });
                return;
            }

            const { text, nextOffset } = buildUpcomingChunk(games, offset, limit);
            if (nextOffset !== null) {
                await ctx.reply(text, { reply_markup: moreKeyboard(nextOffset, limit) });
            } else {
                await ctx.reply(text);
            }

            await ctx.answerCallbackQuery(); // убрать «часики» на кнопке
        } catch (e) {
            log.error('[more:upcoming] failed:', e);
            await ctx.answerCallbackQuery({ text: 'Ошибка' });
        }
    });

    // Показ групп (выпусков) с кнопками действий
    bot.command('groups', async (ctx) => {
        const rows = await getUpcomingGroups();
        if (!rows.length) return ctx.reply('Групп не найдено.');

        // Покажем краткий список и набор кнопок для первых 20
        let msg = rows.map((r: any, i: number) => {
            const name = r.type_name;
            const n = r.num || '?';
            const tick = r.played ? '✅ ' : '';
            return `${i + 1}. ${tick}${name} #${n} — дат: ${r.cnt}`;
        }).join('\n');

        await ctx.reply(msg);

        // отдельными сообщениями — карточки с кнопками
        for (const r of rows.slice(0, 20)) {
            const isExcluded = false; // флаг можно дополнительно узнать, но для простоты опираемся на фильтр в запросе
            const title = `${r.type_name} #${r.num}`;
            await ctx.reply(title, { reply_markup: kbForGroup(`${r.type_name}#${r.num}`, isExcluded) });
        }
    });

    // Сформировать опрос по индексу группы из /groups
    bot.command('poll', async (ctx) => {
        const arg = (ctx.match as string)?.trim();
        if (!arg) return ctx.reply('Использование: /poll <номер из /groups>');

        const idx = Number(arg);
        if (!Number.isFinite(idx) || idx < 1) return ctx.reply('Некорректный номер.');

        const rows = await getUpcomingGroups();
        const row = rows[idx - 1];
        if (!row) return ctx.reply('Группа с таким номером не найдена.');

        // Подтягиваем конкретные даты этой группы из /upcoming
        const games = await getFilteredUpcoming();
        const items = games.filter((g: any) => g.group_key === row.group_key);
        if (items.length < 2) return ctx.reply('По ТЗ опрос создаётся только если дат ≥ 2.');

        const group = { groupKey: row.group_key, name: row.type_name, number: row.num, items };
        await ctx.reply('🗳 Формирую опрос…');
        const msg = await postGroupPoll(bot, group);
        await ctx.reply(msg ? '✅ Опрос опубликован.' : 'Нет данных для опроса.');
    });

    // Управление типами
    bot.command('types', async (ctx) => {
        const rows = await getUpcomingGroups();
        const allTypes = Array.from(new Set(rows.map((r: any) => String(r.type_name))));
        const excluded = new Set(await listExcludedTypes());

        if (!allTypes.length) return ctx.reply('Типы не обнаружены.');

        // Рисуем клавиатуру по 2 в ряд
        const kb = new InlineKeyboard();
        for (const t of allTypes) {
            const isExcluded = excluded.has(t);
            kb.text(isExcluded ? `♻️ ${t}` : `🚫 ${t}`, (isExcluded ? CB.TYPE_UNEXCLUDE : CB.TYPE_EXCLUDE) + t).row();
        }
        await ctx.reply('Управление типами игр (нажатие исключает/возвращает тип):', { reply_markup: kb });
    });

    // Коллбэки
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data!;
        try {
            if (data.startsWith(CB.GROUP_PLAYED)) {
                const key = data.slice(CB.GROUP_PLAYED.length);
                await markGroupPlayed(key);
                await ctx.answerCallbackQuery({ text: 'Отмечено как сыгранное ✅' });
            } else if (data.startsWith(CB.GROUP_EXCLUDE)) {
                const key = data.slice(CB.GROUP_EXCLUDE.length);
                await excludeGroup(key);
                await ctx.answerCallbackQuery({ text: 'Выпуск исключён 🗑️' });
            } else if (data.startsWith(CB.GROUP_UNEXCLUDE)) {
                const key = data.slice(CB.GROUP_UNEXCLUDE.length);
                await unexcludeGroup(key);
                await ctx.answerCallbackQuery({ text: 'Выпуск возвращён ♻️' });
            } else if (data.startsWith(CB.TYPE_EXCLUDE)) {
                const t = data.slice(CB.TYPE_EXCLUDE.length);
                await excludeType(t);
                await ctx.answerCallbackQuery({ text: `Тип «${t}» исключён` });
            } else if (data.startsWith(CB.TYPE_UNEXCLUDE)) {
                const t = data.slice(CB.TYPE_UNEXCLUDE.length);
                await unexcludeType(t);
                await ctx.answerCallbackQuery({ text: `Тип «${t}» возвращён` });
            }
        } catch (e) {
            log.error('Callback error:', e);
            await ctx.answerCallbackQuery({ text: 'Ошибка, см. логи', show_alert: true });
        }
    });

    bot.on('poll_answer', async (ctx) => {
        await handlePollAnswer(ctx.update.poll_answer);
    });

    bot.catch((e) => log.error('[ERROR] Bot error:', e));
    return bot;
}
