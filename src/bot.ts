import { Bot } from 'grammy';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames, getFilteredUpcoming, getUpcomingGroups } from './services/gameService.js';
import { postGroupPoll, handlePollAnswer } from './services/pollService.js';
import { excludeGroup, markGroupPlayed, listExcludedTypes, excludeType, unexcludeType, unexcludeGroup, unmarkGroupPlayed, getChatSetting, setChatSetting, resetChatData, pool } from './db/repositories.js';
import { CB } from './bot/constants.js';
import { moreKeyboard, buildTypesKeyboard } from './bot/ui/keyboards.js';
import { buildPlayedKeyboard } from './bot/ui/keyboards.js';
import { resolveButtonId } from './bot/ui/buttonMapping.js';

function getChatId(ctx: any): string {
    return String(
        ctx.chat?.id ??
        ctx.update?.message?.chat?.id ??
        ctx.update?.callback_query?.message?.chat?.id ??
        ''
    );
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

async function updateChatCommands(bot: Bot, chatId: string, hasSource: boolean) {
    const base = [
        { command: 'help', description: 'Список команд' },
        { command: 'set_source', description: 'Установить ссылку' },
        { command: 'groups', description: 'Показать пакеты' },
        { command: 'upcoming', description: 'Будущие (по пакетам)' },
        { command: 'upcoming_by_dates', description: 'Будущие (по датам)' },
        { command: 'poll', description: 'Создать опрос' },
        { command: 'remove_game_types', description: 'Исключить типы' },
        { command: 'played', description: 'Отметить сыгранные' },
        { command: 'unplayed', description: 'Снять отметку' },
        { command: 'reset', description: 'Очистить данные' },
    ];
    const withSync = hasSource ? [{ command: 'sync', description: 'Синхронизировать игры' }, ...base] : base;
    await bot.api.setMyCommands(withSync, { scope: { type: 'chat', chat_id: chatId } as any });
}

export function createBot() {
    const bot = new Bot(config.token);

    bot.command('start', async (ctx) => {
        await ctx.reply('Привет! Я буду синхронизировать игры Квиз Плиз и формировать опросы. Используйте /help для списка команд.');
        const chatId = getChatId(ctx);
        const saved = (await getChatSetting(chatId, 'source_url')) || '';
        if (!saved) {
            await ctx.reply('Перейдите на страницу Квиз Плиз для вашего города, откройте страницу расписания игр и настройте фильтры. Затем пришлите сюда скопированную из браузера ссылку. Либо используйте команду /set_source <url>.');
        } else {
            await ctx.reply('Источник уже задан. Для смены используйте /set_source <url>. Смотри также /help.');
        }
        await updateChatCommands(bot, chatId, Boolean(saved));
    });

    bot.command('help', async (ctx) => {
        await ctx.reply([
            'Доступные команды:',
            '/set_source <url> — установить/сменить ссылку на расписание.',
            '/sync — обновить данные игр из источника (дополняет существующие).',
            '/upcoming [N] — показать будущих N игр, сгруппировано по пакетам (по умолчанию 15).',
            '/upcoming_by_dates [N] — показать будущих N игр, отсортировано по дате (по умолчанию 15).',
            '/groups — показать список пакетов (игр) с количеством доступных дат.',
            '/poll [N|all] — создать опрос (по номеру N из /groups, all для всех, без параметра = all).',
            '/remove_game_types — открыть клавиатуру для исключения типов пакетов из обработки.',
            '/played [key,...|list] — отметить как сыгранные (список ключей, list для просмотра, без параметра = клавиатура).',
            '/unplayed [key,...|list] — снять отметку «сыграно».',
            '/reset — полностью очистить все данные этого чата (источник, игры, настройки).'
        ].join('\n'));
    });

    // Инфо-уведомление сразу, чтобы не казалось, что «зависло»
    bot.command('sync', async (ctx) => {
        const chatId = getChatId(ctx);
        const saved = (await getChatSetting(chatId, 'source_url')) || '';
        if (!saved) {
            await ctx.reply('Сначала укажите ссылку-источник. Отправьте ссылку с расписанием или используйте /set_source <url>.');
            return;
        }
        try {
            await ctx.reply('🔄 Синхронизация началась, это может занять до пары минут…');
            const { added, skipped } = await syncGames(chatId, saved);
            await ctx.reply('✅ Синхронизация завершена.');
            await ctx.reply(`Добавлено игр: ${added}. Пропущено: ${skipped}.`);
            await setChatSetting(chatId, 'last_sync_at', new Date().toISOString());
        } catch (e) {
            log.error(`[Chat ${chatId}] Sync command failed:`, e);
            await ctx.reply('❌ Ошибка при синхронизации. См. логи.');
        }
    });

    // Установка/смена источника
    bot.command('set_source', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim() || '';
        const chatId = getChatId(ctx);
        if (!arg) return ctx.reply('Инструкция по использованию команды: /set_source [url страницы расписания]');
        try {
            const u = new URL(arg);
            
            // Проверяем, что это ссылка на расписание Квиз Плиз
            if (!u.hostname.includes('quizplease.ru') || !u.pathname.includes('/schedule')) {
                return ctx.reply('Похоже, вы прислали не ту ссылку. Перейдите в раздел «Расписание» на официальном сайте Квиз Плиз для вашего города и пришлите ссылку.');
            }
            
            const currentUrl = await getChatSetting(chatId, 'source_url');
            
            // Если URL меняется, очищаем все данные
            if (currentUrl && currentUrl !== u.toString()) {
                await ctx.reply('⚠️ Смена источника приведёт к удалению всех игр, настроек и опросов. Продолжить? Отправьте: /set_source_confirm <url>');
                await setChatSetting(chatId, 'pending_source_url', u.toString());
                return;
            }
            
            await setChatSetting(chatId, 'source_url', u.toString());
            await ctx.reply('Источник сохранён. Теперь можно запустить /sync.');
            await updateChatCommands(bot, chatId, true);
        } catch {
            await ctx.reply('Некорректная ссылка. Пришлите полноценный URL со страницы расписания официального сайта Квиз Плиз вашего города');
        }
    });

    bot.command('set_source_confirm', async (ctx) => {
        const chatId = getChatId(ctx);
        const pendingUrl = await getChatSetting(chatId, 'pending_source_url');
        
        if (!pendingUrl) {
            return ctx.reply('Нет ожидающего изменения источника. Используйте /set_source <url>');
        }
        
        try {
            // Очищаем все данные чата
            await pool.query('DELETE FROM chat_played_groups WHERE chat_id=$1', [chatId]);
            await pool.query('DELETE FROM chat_excluded_types WHERE chat_id=$1', [chatId]);
            await pool.query('DELETE FROM games WHERE chat_id=$1', [chatId]);
            await pool.query('DELETE FROM polls WHERE chat_id=$1', [chatId]);
            await pool.query('DELETE FROM chat_settings WHERE chat_id=$1 AND key=$2', [chatId, 'last_sync_at']);
            await pool.query('DELETE FROM chat_settings WHERE chat_id=$1 AND key=$2', [chatId, 'pending_source_url']);
            
            // Устанавливаем новый источник
            await setChatSetting(chatId, 'source_url', pendingUrl);
            await ctx.reply('✅ Все данные удалены. Новый источник установлен. Теперь можно запустить /sync.');
            await updateChatCommands(bot, chatId, true);
        } catch (e) {
            log.error('set_source_confirm error:', e);
            await ctx.reply('Ошибка при смене источника. См. логи.');
        }
    });

    // Если источник ещё не задан, примем первое текстовое сообщение с URL как установку источника
    bot.on('message:text', async (ctx, next) => {
        const chatId = getChatId(ctx);
        const saved = (await getChatSetting(chatId, 'source_url')) || '';
        const text = ctx.message.text.trim();
        if (!text.startsWith('/') && !saved) {
            try {
                const u = new URL(text);
                
                // Проверяем, что это ссылка на расписание Квиз Плиз
                if (!u.hostname.includes('quizplease.ru') || !u.pathname.includes('/schedule')) {
                    await ctx.reply('Похоже, вы прислали не ту ссылку. Перейдите в раздел «Расписание» на официальном сайте Квиз Плиз для вашего города и пришлите ссылку.');
                    return;
                }
                
                await setChatSetting(chatId, 'source_url', u.toString());
                await ctx.reply('Источник сохранён. Теперь можно запустить /sync.');
                await updateChatCommands(bot, chatId, true);
                return;
            } catch {}
        }
        return next();
    });

    bot.command('upcoming', async (ctx) => {
        try {
            const arg = (ctx.match as string | undefined) ?? '';
            const limit = parseLimit(arg, 15);

            await ctx.reply(arg?.trim()
                ? `Будущие ${limit} игр (сгруппировано по пакетам)`
                : 'Будущие игры (сгруппировано по пакетам)');

            const games = await getFilteredUpcoming(getChatId(ctx));
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
            await ctx.reply('Не удалось получить список будущих игр :(');
        }
    });

    bot.command('upcoming_by_dates', async (ctx) => {
        try {
            const arg = (ctx.match as string | undefined) ?? '';
            const limit = parseLimit(arg, 15);

            await ctx.reply(arg?.trim()
                ? `Будущие ${limit} игр (по дате)`
                : 'Будущие игры (по дате)');

            const games = await getFilteredUpcoming(getChatId(ctx));
            if (!games.length) {
                await ctx.reply('Пока ничего нет.');
                return;
            }

            // Сортируем по дате вместо group_key
            const sortedByDate = [...games].sort((a, b) => 
                new Date(a.date_time).getTime() - new Date(b.date_time).getTime()
            );

            const { text, nextOffset } = buildUpcomingChunk(sortedByDate, 0, limit);
            if (nextOffset !== null) {
                await ctx.reply(text, { reply_markup: moreKeyboard(nextOffset, limit) });
            } else {
                await ctx.reply(text);
            }
        } catch (e) {
            log.error('[upcoming_by_dates] failed:', e);
            await ctx.reply('Не удалось получить список будущих игр :(');
        }
    });

    // Обработка "Показать ещё"
    bot.callbackQuery(/^more:upcoming:(\d+):(\d+)$/, async (ctx) => {
        try {
            const [, offStr, limStr] = ctx.match!;
            const offset = parseInt(offStr, 10);
            const limit = parseInt(limStr, 10);

            const games = await getFilteredUpcoming(getChatId(ctx));
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

    // Показ групп (выпусков) списком без кнопок
    bot.command('groups', async (ctx) => {
        const rows = await getUpcomingGroups(getChatId(ctx));
        if (!rows.length) return ctx.reply('Пакетов игр не найдено.');

        // Краткий список
        let msg = rows.map((r: any, i: number) => {
            const name = r.type_name;
            const n = r.num || '?';
            const icons = `${r.played ? '✅ ' : ''}${r.polled ? '🗳 ' : ''}`;
            return `${i + 1}. ${icons}${name} #${n} — дат: ${r.cnt}`;
        }).join('\n');

        await ctx.reply(msg);
    });

    // Пометить выпуск(и) как сыгранные: текстовый режим, клавиатура, список
    bot.command('played', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim() || '';
        if (!arg) {
            const rows = await getUpcomingGroups(getChatId(ctx));
            if (!rows.length) return ctx.reply('Пакетов игр не найдено.');
            const kb = buildPlayedKeyboard(rows);
            return ctx.reply('Отметить выпуски как сыгранные/несыгранные:', { reply_markup: kb });
        }

        if (arg.toLowerCase() === 'list') {
            const rows = await getUpcomingGroups(getChatId(ctx));
            const played = rows.filter((r: any) => r.played);
            if (!played.length) return ctx.reply('Сыгранных выпусков нет.');
            const msg = played.map((r: any) => `${r.type_name} #${r.num}`).join('\n');
            return ctx.reply(msg);
        }

        const keys = arg
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (!keys.length) return ctx.reply('Не распознаны ключи групп. Пример: /played КвизПлиз#123');

        let ok = 0;
        for (const k of keys) {
            try { await markGroupPlayed(getChatId(ctx), k); ok++; } catch (e) { log.error('played error for', k, e); }
        }
        await ctx.reply(`Готово. Отмечено как сыгранные: ${ok}/${keys.length}.`);
    });

    // Снять пометку «сыграно»: текстовый режим, клавиатура, список
    bot.command('unplayed', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim() || '';
        if (!arg) {
            const rows = await getUpcomingGroups(getChatId(ctx));
            if (!rows.length) return ctx.reply('Пакетов игр не найдено.');
            const kb = buildPlayedKeyboard(rows);
            return ctx.reply('Отметить выпуски как сыгранные/несыгранные:', { reply_markup: kb });
        }

        if (arg.toLowerCase() === 'list') {
            const rows = await getUpcomingGroups(getChatId(ctx));
            const unplayed = rows.filter((r: any) => !r.played);
            if (!unplayed.length) return ctx.reply('Несыгранных выпусков нет.');
            const msg = unplayed.map((r: any) => `${r.type_name} #${r.num}`).join('\n');
            return ctx.reply(msg);
        }

        const keys = arg
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (!keys.length) return ctx.reply('Не распознаны ключи групп. Пример: /unplayed КвизПлиз#123');

        let ok = 0;
        for (const k of keys) {
            try { await unmarkGroupPlayed(getChatId(ctx), k); ok++; } catch (e) { log.error('unplayed error for', k, e); }
        }
        await ctx.reply(`Готово. Снята пометка «сыграно» для: ${ok}/${keys.length}.`);
    });

    // Сформировать опрос: по номеру или для всех сразу
    bot.command('poll', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim();
        const chatId = getChatId(ctx);

        const rows = await getUpcomingGroups(chatId);
        const games = await getFilteredUpcoming(chatId);

        const createForRow = async (row: any, requireMultipleDates = true) => {
            const items = games.filter((g: any) => g.group_key === row.group_key);
            if (requireMultipleDates && items.length < 2) return false;
            if (!items.length) return false;
            const group = { groupKey: row.group_key, name: row.type_name, number: row.num, items };
            const msg = await postGroupPoll(bot, chatId, group);
            return Boolean(msg);
        };

        // Без аргумента или "all" - создать для всех
        if (!arg || arg.toLowerCase() === 'all') {
            await ctx.reply('Будут созданы опросы по выпускам, где дат два и более, и для которых опросы ещё не публиковались.');
            let created = 0;
            for (const row of rows) {
                if (row.polled) continue;
                const ok = await createForRow(row);
                if (ok) created++;
            }
            return ctx.reply(created ? `✅ Опросов создано: ${created}` : 'Нет пакетов (игр) для создания опросов.');
        }

        // По номеру - создать даже для одной даты
        const idx = Number(arg);
        if (!Number.isFinite(idx) || idx < 1) return ctx.reply('Инструкция по использованию команды: /poll [номер|all]');
        const row = rows[idx - 1];
        if (!row) return ctx.reply('Группа с таким номером не найдена.');
        
        const items = games.filter((g: any) => g.group_key === row.group_key);
        if (!items.length) {
            return ctx.reply(`❌ Для группы "${row.type_name} #${row.num}" не найдено дат.`);
        }
        
        const ok = await createForRow(row, false);
        await ctx.reply(ok ? '✅ Опрос опубликован.' : '❌ Ошибка при создании опроса.');
    });

    // Управление типами
    bot.command('remove_game_types', async (ctx) => {
        const rows = await getUpcomingGroups(getChatId(ctx));
        const allTypes = Array.from(new Set(rows.map((r: any) => String(r.type_name))));
        const excluded = new Set(await listExcludedTypes(getChatId(ctx)));

        if (!allTypes.length) return ctx.reply('Пакеты (игры) не обнаружены.');

        const kb = buildTypesKeyboard(allTypes, excluded);
        await ctx.reply('Управление типами игр (нажатие исключает/возвращает тип):', { reply_markup: kb });
    });

    // Коллбэки
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data!;
        try {
            if (data.startsWith(CB.GROUP_PLAYED)) {
                const key = data.slice(CB.GROUP_PLAYED.length);
                await markGroupPlayed(getChatId(ctx), key);
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
                const buttonId = data.slice(CB.TYPE_EXCLUDE.length);
                const t = resolveButtonId(buttonId);
                if (!t) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                await excludeType(getChatId(ctx), t);
                const rows = await getUpcomingGroups(getChatId(ctx));
                const allTypes = Array.from(new Set(rows.map((r: any) => String(r.type_name))));
                const excluded = new Set(await listExcludedTypes(getChatId(ctx)));
                const kb = buildTypesKeyboard(allTypes, excluded);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: `Тип «${t}» исключён` });
            } else if (data.startsWith(CB.TYPE_UNEXCLUDE)) {
                const buttonId = data.slice(CB.TYPE_UNEXCLUDE.length);
                const t = resolveButtonId(buttonId);
                if (!t) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                await unexcludeType(getChatId(ctx), t);
                const rows = await getUpcomingGroups(getChatId(ctx));
                const allTypes = Array.from(new Set(rows.map((r: any) => String(r.type_name))));
                const excluded = new Set(await listExcludedTypes(getChatId(ctx)));
                const kb = buildTypesKeyboard(allTypes, excluded);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: `Тип «${t}» возвращён` });
            } else if (data.startsWith(CB.PLAYED_MARK)) {
                const buttonId = data.slice(CB.PLAYED_MARK.length);
                const key = resolveButtonId(buttonId);
                if (!key) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                await markGroupPlayed(getChatId(ctx), key);
                const rows = await getUpcomingGroups(getChatId(ctx));
                const kb = buildPlayedKeyboard(rows);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: 'Отмечено как сыгранное ✅' });
            } else if (data.startsWith(CB.PLAYED_UNMARK)) {
                const buttonId = data.slice(CB.PLAYED_UNMARK.length);
                const key = resolveButtonId(buttonId);
                if (!key) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                await unmarkGroupPlayed(getChatId(ctx), key);
                const rows = await getUpcomingGroups(getChatId(ctx));
                const kb = buildPlayedKeyboard(rows);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: 'Снята отметка «сыграно»' });
            }
        } catch (e) {
            log.error('Callback error:', e);
            await ctx.answerCallbackQuery({ text: 'Ошибка, см. логи', show_alert: true });
        }
    });

    bot.on('poll_answer', async (ctx) => {
        await handlePollAnswer(ctx.update.poll_answer);
    });

    // Команда сброса всех данных чата
    bot.command('reset', async (ctx) => {
        const chatId = getChatId(ctx);
        await ctx.reply('⚠️ Вы уверены? Это удалит все данные чата: источник, игры, настройки, опросы. Для подтверждения отправьте: /reset_confirm');
    });

    bot.command('reset_confirm', async (ctx) => {
        const chatId = getChatId(ctx);
        try {
            await resetChatData(chatId);
            await updateChatCommands(bot, chatId, false);
            await ctx.reply('✅ Все данные чата удалены. Для начала работы отправьте ссылку на расписание или используйте /set_source.');
        } catch (e) {
            log.error('Reset error:', e);
            await ctx.reply('Ошибка при сбросе данных. См. логи.');
        }
    });

    bot.catch((e) => log.error('[ERROR] Bot error:', e));
    return bot;
}
