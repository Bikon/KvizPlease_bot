import type { Context } from 'grammy';
import { Bot } from 'grammy';

import { config } from './config.js';
import { CITIES } from './bot/cities.js';
import { CB } from './bot/constants.js';
import { resolveButtonId } from './bot/ui/buttonMapping.js';
import {
    buildCitySelectionKeyboard,
    buildPlayedKeyboard,
    buildPollsByDateKeyboard,
    buildTypesKeyboard,
    moreKeyboard,
} from './bot/ui/keyboards.js';
import {
    countAllUpcomingGames,
    deletePastGames,
    excludeGroup,
    excludeType,
    getChatSetting,
    listExcludedTypes,
    markGroupPlayed,
    pool,
    resetChatData,
    setChatSetting,
    unexcludeGroup,
    unexcludeType,
    unmarkGroupPlayed,
} from './db/repositories.js';
import {
    getFilteredUpcoming,
    getUpcomingGroups,
    syncGames,
} from './services/gameService.js';
import {
    createPollsByDatePeriod,
    createPollsByDateRange,
    handlePollAnswer,
    postGroupPoll,
} from './services/pollService.js';
import { formatGameDateTime } from './utils/dateFormatter.js';
import { log } from './utils/logger.js';
import { parseDate, formatDateForDisplay, validateDateRange } from './utils/dateParser.js';
import { setConversationState, getConversationState, clearConversationState, updateConversationData } from './utils/conversationState.js';
import type { DbGame, DbGameGroup } from './types.js';

function getChatId(ctx: Context): string {
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
function formatGame(g: DbGame, idx: number): string {
    const { dd, mm, yyyy, hh, mi } = formatGameDateTime(g.date_time);
    const place = g.venue ?? '-';
    const url = g.url ?? '';

    return `${idx}. ${g.title}\n${dd}.${mm}.${yyyy}, ${hh}:${mi}:00 — ${place} (-)\n${url}`;
}

// Собираем текст порции и возвращаем nextOffset (если есть ещё)
function buildUpcomingChunk(
    games: DbGame[],
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
        { command: 'select_city', description: 'Выбрать город' },
        { command: 'set_source', description: 'Установить ссылку на расписание вручную' },
        { command: 'gamepacks', description: 'Показать пакеты игр' },
        { command: 'upcoming', description: 'Будущие игры (по пакетам)' },
        { command: 'upcoming_by_dates', description: 'Будущие игры (по датам)' },
        { command: 'poll', description: 'Создать опрос' },
        { command: 'polls_by_date', description: 'Опросы по периодам' },
        { command: 'remove_game_types', description: 'Исключить типы пакетов' },
        { command: 'played', description: 'Отметить сыгранные' },
        { command: 'unplayed', description: 'Снять отметку' },
        { command: 'reset', description: 'Очистить данные' },
    ];
    const withSync = hasSource ? [{ command: 'sync', description: 'Синхронизировать игры из расписания' }, ...base] : base;
    await bot.api.setMyCommands(withSync, { scope: { type: 'chat', chat_id: chatId } as any });
}

export function createBot() {
    const bot = new Bot(config.token);

    bot.command('start', async (ctx) => {
        const chatId = getChatId(ctx);
        const saved = (await getChatSetting(chatId, 'source_url')) || '';
        
        // Если бот уже был настроен - предлагаем очистить историю
        if (saved) {
            await ctx.reply('С возвращением! Бот уже настроен.');
            await ctx.reply('Хотите начать заново с очисткой всех данных? Используйте /reset\n\nДля продолжения работы с текущими данными используйте команды из меню или /help.');
            await updateChatCommands(bot, chatId, true);
            return;
        }
        
        // Первый запуск
        await ctx.reply('Привет! Я буду синхронизировать игры Квиз Плиз и формировать опросы. Используйте /help для списка команд.');
        await ctx.reply('Выберите ваш город с помощью /select_city или укажите ссылку на расписание вручную командой /set_source <url>.');
        await updateChatCommands(bot, chatId, false);
    });

    bot.command('help', async (ctx) => {
        await ctx.reply([
            'Доступные команды:',
            '/select_city — выбрать город из списка (автоматически установит источник).',
            '/set_source <url> — установить/сменить ссылку на расписание вручную.',
            '/sync — обновить данные игр из источника (дополняет существующие, удаляет прошедшие).',
            '/upcoming [N] — показать будущих N игр, сгруппировано по пакетам (по умолчанию 15).',
            '/upcoming_by_dates [N] — показать будущих N игр, отсортировано по дате (по умолчанию 15).',
            '/gamepacks — показать список пакетов (игр) с количеством доступных дат.',
            '/poll [N|all] — создать опрос (по номеру N из /gamepacks, all для всех, без параметра = all).',
            '/polls_by_date — создать опросы по играм, сгруппированным по дате (неделя/2 недели/месяц/свой период).',
            '/remove_game_types — открыть клавиатуру для исключения типов пакетов из обработки.',
            '/played [key,...|list] — отметить как сыгранные (список ключей, list для просмотра, без параметра = клавиатура).',
            '/unplayed [key,...|list] — снять отметку «сыграно».',
            '/cancel — отменить текущий диалог (например, ввод дат).',
            '/reset — полностью очистить все данные этого чата (источник, игры, настройки).'
        ].join('\n'));
    });

    bot.command('cancel', async (ctx) => {
        const chatId = getChatId(ctx);
        const state = getConversationState(chatId);
        
        if (state) {
            clearConversationState(chatId);
            await ctx.reply('❌ Диалог отменён.');
        } else {
            await ctx.reply('Нет активного диалога для отмены.');
        }
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
            
            // Получаем текущее количество игр перед синком (с учётом фильтров)
            const beforeCount = await countAllUpcomingGames(chatId, config.filters.daysAhead, config.filters.districts);
            
            // Удаляем устаревшие игры
            const deletedPast = await deletePastGames(chatId);
            
            const { added, skipped, excluded } = await syncGames(chatId, saved);
            
            await ctx.reply('✅ Синхронизация завершена.');
            
            // Получаем количество после синка (с учётом фильтров)
            const afterCount = await countAllUpcomingGames(chatId, config.filters.daysAhead, config.filters.districts);
            const newGamesCount = Math.max(0, afterCount - beforeCount);
            
            let message;
            if (beforeCount === 0) {
                // Первая синхронизация
                const filtered = added - afterCount;
                message = `Добавлено игр в базу: ${added}.\n` +
                    `Доступно для отображения: ${afterCount}.\n`;
                if (filtered > 0) {
                    message += `Скрыто фильтрами (за пределами 30 дней или другие ограничения): ${filtered}.\n`;
                }
                message += `Пропущено: ${skipped}.\n`;
            } else {
                // Последующие синхронизации
                message = `Добавлено новых игр: ${newGamesCount}.\n` +
                    `Всего доступно: ${afterCount}.\n` +
                    `Исключено из обработки (по вашим настройкам): ${excluded}.\n` +
                    `Пропущено: ${skipped}.\n`;
            }
            
            if (deletedPast > 0) {
                message += `Удалено игр с прошедшей датой: ${deletedPast}.\n`;
            }
            
            message += `\nВоспользуйтесь командами из меню, чтобы получить информацию об играх или составить опросы об участии. Полный список команд с описанием можно получить с помощью /help`;
            
            await ctx.reply(message);
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
            await ctx.reply('Источник сохранён. Теперь можно запустить синхронизацию расписания игр /sync.');
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
            await ctx.reply('✅ Все данные удалены. Новый источник установлен. Теперь можно запустить синхронизацию расписания игр /sync.');
            await updateChatCommands(bot, chatId, true);
        } catch (e) {
            log.error('set_source_confirm error:', e);
            await ctx.reply('Ошибка при смене источника. См. логи.');
        }
    });

    // Выбор города из списка
    bot.command('select_city', async (ctx) => {
        const kb = buildCitySelectionKeyboard();
        await ctx.reply('Выберите ваш город из списка:\n\nЕсли вашего города нет в списке, используйте команду /set_source <url> для ручной установки ссылки.', { reply_markup: kb });
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

    // Показ пакетов игр списком без кнопок
    bot.command('gamepacks', async (ctx) => {
        const rows = await getUpcomingGroups(getChatId(ctx));
        if (!rows.length) return ctx.reply('Пакетов игр не найдено.');

        // Краткий список
        let msg = rows.map((r, i) => {
            const name = r.type_name;
            const n = r.num || '?';
            let icons = '';
            if (r.played) icons += '✅ ';
            if (r.polled_by_package) icons += '🗳 ';
            if (r.polled_by_date) icons += '📅 ';
            return `${i + 1}. ${icons}${name} #${n} — дат: ${r.cnt}`;
        }).join('\n');

        // Добавляем легенду
        msg += '\n\n📖 Легенда:\n';
        msg += '✅ — сыграно\n';
        msg += '🗳 — опрос по пакету создан\n';
        msg += '📅 — игра из пакета участвует в опросе по дате';

        await ctx.reply(msg);
    });

    // Пометить пакет(ы) как сыгранные: текстовый режим, клавиатура, список
    bot.command('played', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim() || '';
        if (!arg) {
            const rows = await getUpcomingGroups(getChatId(ctx));
            if (!rows.length) return ctx.reply('Пакетов игр не найдено.');
            const kb = buildPlayedKeyboard(rows);
            return ctx.reply('Отметить пакеты как сыгранные/несыгранные:', { reply_markup: kb });
        }

        if (arg.toLowerCase() === 'list') {
            const rows = await getUpcomingGroups(getChatId(ctx));
            const played = rows.filter((r) => r.played);
            if (!played.length) return ctx.reply('Сыгранных пакетов нет.');
            const msg = played.map((r) => `${r.type_name} #${r.num}`).join('\n');
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
            return ctx.reply('Отметить пакеты как сыгранные/несыгранные:', { reply_markup: kb });
        }

        if (arg.toLowerCase() === 'list') {
            const rows = await getUpcomingGroups(getChatId(ctx));
            const unplayed = rows.filter((r) => !r.played);
            if (!unplayed.length) return ctx.reply('Несыгранных пакетов нет.');
            const msg = unplayed.map((r) => `${r.type_name} #${r.num}`).join('\n');
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

        const createForRow = async (row: DbGameGroup, requireMultipleDates = true): Promise<boolean> => {
            const items = games.filter((g) => g.group_key === row.group_key);
            if (requireMultipleDates && items.length < 2) return false;
            if (!items.length) return false;
            const group = { groupKey: row.group_key, name: row.type_name, number: row.num, items };
            const msg = await postGroupPoll(bot, chatId, group);
            return Boolean(msg);
        };

        // Без аргумента или "all" - создать для всех
        if (!arg || arg.toLowerCase() === 'all') {
            await ctx.reply('Будут созданы опросы по пакетам игр, где дат два и более, и для которых опросы ещё не публиковались.');
            let created = 0;
            for (const row of rows) {
                if (row.polled_by_package) continue; // Пропускаем только те, для которых опрос уже создан по пакету
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
        
        const items = games.filter((g) => g.group_key === row.group_key);
        if (!items.length) {
            return ctx.reply(`❌ Для группы "${row.type_name} #${row.num}" не найдено дат.`);
        }
        
        const ok = await createForRow(row, false);
        await ctx.reply(ok ? '✅ Опрос опубликован.' : '❌ Ошибка при создании опроса.');
    });

    // Управление типами
    bot.command('remove_game_types', async (ctx) => {
        const rows = await getUpcomingGroups(getChatId(ctx));
        const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
        const excluded = new Set(await listExcludedTypes(getChatId(ctx)));

        if (!allTypes.length) return ctx.reply('Пакеты (игры) не обнаружены.');

        const kb = buildTypesKeyboard(allTypes, excluded);
        await ctx.reply('Управление типами игр (нажатие исключает/возвращает тип):', { reply_markup: kb });
    });

    // Создание опросов по датам (не по пакетам)
    bot.command('polls_by_date', async (ctx) => {
        const kb = buildPollsByDateKeyboard();
        await ctx.reply(
            'Создание опросов по играм, сгруппированным по периоду времени.\n\n' +
            'Будут созданы опросы, где каждый опрос охватывает игры в указанном периоде. ' +
            'Название опроса — период времени. Варианты ответа — отдельные игры с датами и местами.\n\n' +
            'Выберите период:',
            { reply_markup: kb }
        );
    });

    // Коллбэки
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data!;
        const chatId = getChatId(ctx);
        try {
            if (data.startsWith(CB.POLLS_BY_DATE)) {
                const period = data.slice(CB.POLLS_BY_DATE.length);
                
                if (period === 'custom') {
                    // Начинаем диалог для ввода дат
                    log.info(`[Conversation] Starting custom date dialog for chat ${chatId}`);
                    setConversationState(chatId, 'waiting_start_date');
                    await ctx.answerCallbackQuery({ text: 'Введите даты' });
                    await ctx.reply(
                        '📆 Введите дату начала периода в формате:\n' +
                        '• ДД.ММ.ГГГГ (например, 15.12.2024)\n' +
                        '• ДД.ММ.ГГ (например, 15.12.24)\n' +
                        '• ДД.ММ (например, 15.12 - будет использован текущий год)\n\n' +
                        '⚠️ В групповом чате: ответьте (reply) на это сообщение с датой\n' +
                        'или отправьте /cancel для отмены.'
                    );
                    return;
                }
                
                let days = 7;
                if (period === '2weeks') days = 14;
                else if (period === 'month') days = 30;
                
                const games = await getFilteredUpcoming(chatId);
                const created = await createPollsByDatePeriod(bot, chatId, games, days);
                
                await ctx.answerCallbackQuery({ text: created ? `Создано: ${created}` : 'Нет игр' });
                if (created > 0) {
                    const pollWord = created === 1 ? 'опрос' : created < 5 ? 'опроса' : 'опросов';
                    await ctx.reply(`✅ Создано ${created} ${pollWord} для игр на ${days} дней вперёд.`);
                } else {
                    await ctx.reply('Нет игр в выбранном периоде.');
                }
            } else if (data.startsWith(CB.CITY_SELECT)) {
                const cityKey = data.slice(CB.CITY_SELECT.length);
                const city = CITIES[cityKey as keyof typeof CITIES];
                
                if (!city) {
                    return await ctx.answerCallbackQuery({ text: 'Город не найден' });
                }
                
                const currentUrl = await getChatSetting(chatId, 'source_url');
                
                // Если источник уже был установлен, требуем подтверждение
                if (currentUrl && currentUrl !== city.url) {
                    await setChatSetting(chatId, 'pending_source_url', city.url);
                    await ctx.answerCallbackQuery({ text: `Город: ${city.name}` });
                    await ctx.reply(`⚠️ Смена города на ${city.name} приведёт к удалению всех игр, настроек и опросов. Продолжить? Отправьте: /set_source_confirm`);
                    return;
                }
                
                await setChatSetting(chatId, 'source_url', city.url);
                await ctx.answerCallbackQuery({ text: `Выбран ${city.name}` });
                await ctx.reply(`✅ Город ${city.name} выбран. Теперь можно запустить синхронизацию расписания игр /sync.`);
                await updateChatCommands(bot, chatId, true);
            } else if (data.startsWith(CB.GROUP_PLAYED)) {
                const key = data.slice(CB.GROUP_PLAYED.length);
                await markGroupPlayed(chatId, key);
                await ctx.answerCallbackQuery({ text: 'Отмечено как сыгранное ✅' });
            } else if (data.startsWith(CB.GROUP_EXCLUDE)) {
                const key = data.slice(CB.GROUP_EXCLUDE.length);
                await excludeGroup(key);
                await ctx.answerCallbackQuery({ text: 'Пакет исключён 🗑️' });
            } else if (data.startsWith(CB.GROUP_UNEXCLUDE)) {
                const key = data.slice(CB.GROUP_UNEXCLUDE.length);
                await unexcludeGroup(key);
                await ctx.answerCallbackQuery({ text: 'Пакет возвращён ♻️' });
            } else if (data.startsWith(CB.TYPE_EXCLUDE)) {
                const buttonId = data.slice(CB.TYPE_EXCLUDE.length);
                const t = resolveButtonId(buttonId);
                if (!t) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                await excludeType(getChatId(ctx), t);
                const rows = await getUpcomingGroups(getChatId(ctx));
                const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
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
                const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
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

    // Обработка текстовых сообщений для диалогов
    bot.on('message:text', async (ctx) => {
        const chatId = getChatId(ctx);
        const text = ctx.message.text;
        
        // Игнорируем команды - они обрабатываются отдельными хендлерами
        if (text.startsWith('/')) return;
        
        const state = getConversationState(chatId);
        
        if (!state) return; // Если нет активного диалога, пропускаем
        
        // В группах проверяем, что это либо reply к боту, либо бот может читать все сообщения
        if (ctx.chat?.type !== 'private') {
            const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
            if (!isReplyToBot) {
                // В группе без reply - молча игнорируем
                return;
            }
        }
        
        try {
            log.info(`[Conversation] Chat ${chatId} in step ${state.step}, received: ${text}`);
            
            if (state.step === 'waiting_start_date') {
                const startDate = parseDate(text);
                if (!startDate) {
                    log.warn(`[Conversation] Failed to parse start date: ${text}`);
                    await ctx.reply('❌ Неверный формат даты. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                // Проверяем, что дата не в прошлом
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                if (startDate < now) {
                    log.warn(`[Conversation] Start date is in the past: ${startDate}`);
                    await ctx.reply('❌ Дата начала не может быть в прошлом. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                // Сохраняем дату начала и просим ввести дату окончания
                log.info(`[Conversation] Start date accepted: ${formatDateForDisplay(startDate)}`);
                setConversationState(chatId, 'waiting_end_date', { startDate: startDate.toISOString() });
                
                await ctx.reply(
                    `✅ Дата начала: ${formatDateForDisplay(startDate)}\n\n` +
                    '📆 Теперь введите дату окончания периода в том же формате:\n' +
                    '• ДД.ММ.ГГГГ (например, 31.12.2024)\n' +
                    '• ДД.ММ.ГГ (например, 31.12.24)\n' +
                    '• ДД.ММ (например, 31.12)\n\n' +
                    '⚠️ В групповом чате: ответьте (reply) на это сообщение\n' +
                    'или отправьте /cancel для отмены.'
                );
            } else if (state.step === 'waiting_end_date') {
                const endDate = parseDate(text);
                if (!endDate) {
                    log.warn(`[Conversation] Failed to parse end date: ${text}`);
                    await ctx.reply('❌ Неверный формат даты. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                const startDate = new Date(state.data.startDate);
                
                // Проверяем, что дата окончания после даты начала
                if (!validateDateRange(startDate, endDate)) {
                    log.warn(`[Conversation] End date ${formatDateForDisplay(endDate)} is not after start date ${formatDateForDisplay(startDate)}`);
                    await ctx.reply(`❌ Дата окончания должна быть позже даты начала (${formatDateForDisplay(startDate)}). Попробуйте снова или отправьте /cancel для отмены.`);
                    return;
                }
                
                // Создаём опросы
                log.info(`[Conversation] Creating polls for date range: ${formatDateForDisplay(startDate)} - ${formatDateForDisplay(endDate)}`);
                clearConversationState(chatId);
                
                await ctx.reply(`⏳ Создаю опросы для периода с ${formatDateForDisplay(startDate)} по ${formatDateForDisplay(endDate)}...`);
                
                const games = await getFilteredUpcoming(chatId);
                const created = await createPollsByDateRange(bot, chatId, games, startDate, endDate);
                
                if (created > 0) {
                    const pollWord = created === 1 ? 'опрос' : created < 5 ? 'опроса' : 'опросов';
                    await ctx.reply(`✅ Создано ${created} ${pollWord} для игр с ${formatDateForDisplay(startDate)} по ${formatDateForDisplay(endDate)}.`);
                } else {
                    await ctx.reply('❌ Нет игр в выбранном периоде.');
                }
            }
        } catch (e) {
            log.error('[Conversation] Error:', e);
            clearConversationState(chatId);
            await ctx.reply('❌ Произошла ошибка. Диалог отменён.');
        }
    });

    bot.on('poll_answer', async (ctx) => {
        const pollAnswer = ctx.update.poll_answer;
        if (!pollAnswer.user) return;
        await handlePollAnswer(pollAnswer as { poll_id: string; user: { id: number }; option_ids: number[] });
    });

    // Команда сброса всех данных чата
    bot.command('reset', async (ctx) => {
        await ctx.reply('⚠️ Вы уверены? Это удалит все данные чата: источник, игры, настройки, опросы. Для подтверждения отправьте: /reset_confirm');
    });

    bot.command('reset_confirm', async (ctx) => {
        const chatId = getChatId(ctx);
        try {
            await resetChatData(chatId);
            await updateChatCommands(bot, chatId, false);
            await ctx.reply('✅ Все данные чата удалены. Для начала работы выберите город с помощью /select_city или используйте /set_source для ручной установки ссылки.');
        } catch (e) {
            log.error('Reset error:', e);
            await ctx.reply('Ошибка при сбросе данных. См. логи.');
        }
    });

    bot.catch((e) => log.error('[ERROR] Bot error:', e));
    return bot;
}
