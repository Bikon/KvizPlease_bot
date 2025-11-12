import type { Context } from 'grammy';
import { Bot } from 'grammy';

import { config } from './config.js';
import { CITIES } from './bot/cities.js';
import { CB } from './bot/constants.js';
import { resolveButtonId } from './bot/ui/buttonMapping.js';
import {
    buildCitySelectionKeyboard,
    buildGameSelectionKeyboard,
    buildGameTypesMenuKeyboard,
    buildPlayedKeyboard,
    buildPollsByDateKeyboard,
    buildPollsByPackageKeyboard,
    buildPollsByTypesDateFilterKeyboard,
    buildPollsByTypesKeyboard,
    buildPollsMainMenuKeyboard,
    buildPollSelectionKeyboard,
    buildRegisteredGamesKeyboard,
    buildRestoreTypesKeyboard,
    buildTypesKeyboard,
    moreKeyboard,
} from './bot/ui/keyboards.js';
import {
    changeSourceUrl,
    countAllUpcomingGames,
    deletePastGames,
    excludeGroup,
    excludeType,
    findUnprocessedPollsWithVotes,
    getGameByExternalId,
    getChatSetting,
    getPollOptionVotes,
    getTeamInfo,
    listExcludedTypes,
    markGameRegistered,
    markGroupPlayed,
    markPollProcessedForRegistration,
    resetChatData,
    saveTeamInfo,
    setChatSetting,
    unexcludeGroup,
    unexcludeType,
    unmarkGameRegistered,
    unmarkGroupPlayed,
    type TeamInfo,
    type PollWithVotes,
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
import { filterGamesByTypes, getPollWordForm, sortGamesByDate } from './utils/gameFilters.js';
import { log } from './utils/logger.js';
import { parseDate, formatDateForDisplay, formatDateTimeForDisplay, validateDateRange } from './utils/dateParser.js';
import { isValidEmail, validateAndNormalizePhone } from './utils/patterns.js';
import { setConversationState, getConversationState, clearConversationState } from './utils/conversationState.js';
import { toggleSelectedType, getSelectedTypes, clearSelectedTypes } from './utils/selectedTypes.js';
import { toggleSelectedPoll, getSelectedPolls, clearSelectedPolls, toggleSelectedGame, getSelectedGames, clearSelectedGames, setPollGameMapping, getPollGameMapping, clearAllRegistrationState } from './utils/registrationState.js';
import { registerForGame } from './services/registrationService.js';
import type { DbGame } from './types.js';

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

function truncateText(text: string, maxLength = 48): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
}

async function buildPollSelectionItems(chatId: string, polls: PollWithVotes[]) {
    const items: Array<{ poll_id: string; label: string; vote_count: number }> = [];

    for (const poll of polls) {
        const optionVotes = await getPollOptionVotes(poll.poll_id);
        const validOptions = optionVotes.filter((opt) => !opt.is_unavailable && opt.vote_count >= 2);

        if (!validOptions.length) {
            continue;
        }

        const maxVotes = Math.max(...validOptions.map((opt) => opt.vote_count));
        const winners = validOptions.filter((opt) => opt.vote_count === maxVotes);

        let leaderSummary: string | null = null;

        for (const winner of winners) {
            if (!winner.game_external_id) continue;
            const game = await getGameByExternalId(chatId, winner.game_external_id);
            if (!game) continue;
            const { dd, mm, hh, mi } = formatGameDateTime(game.date_time);
            const title = truncateText(game.title ?? 'Игра');
            leaderSummary = `${title} • ${dd}.${mm} ${hh}:${mi}`;
            break;
        }

        const createdAtDisplay = poll.created_at ? formatDateTimeForDisplay(new Date(poll.created_at)) : null;
        const baseTitle = poll.group_key || `Опрос #${poll.message_id}`;
        const infoParts = [baseTitle];

        if (leaderSummary) {
            infoParts.push(leaderSummary);
        } else if (createdAtDisplay) {
            infoParts.push(`создан ${createdAtDisplay}`);
        }

        const label = infoParts.join(' • ');

        items.push({
            poll_id: poll.poll_id,
            label,
            vote_count: poll.vote_count,
        });
    }

    return items;
}

async function updateChatCommands(bot: Bot, chatId: string, hasSource: boolean) {
    const base = [
        { command: 'help', description: 'Список команд' },
        { command: 'select_city', description: 'Выбрать город' },
        { command: 'set_source', description: 'Установить ссылку на расписание вручную' },
        { command: 'game_packs_management', description: 'Пакеты и типы игр' },
        { command: 'upcoming', description: 'Будущие игры (по пакетам)' },
        { command: 'upcoming_by_dates', description: 'Будущие игры (по датам)' },
        { command: 'polls', description: 'Создать опросы' },
        { command: 'played', description: 'Управление статусом игр' },
        { command: 'team_info', description: 'Информация о команде' },
        { command: 'register_from_polls', description: 'Регистрация по опросам' },
        { command: 'registered', description: 'Управление регистрациями' },
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
            '/game_packs_management — список пакетов и управление типами игр.',
            '/polls — создать опросы (меню: по типам / по датам / по пакету / для всех).',
            '/played — управление статусом игр.',
            '/team_info — информация о команде (просмотр/редактирование).',
            '/register_from_polls — проанализировать опросы и зарегистрироваться на игры.',
            '/registered — управление статусами регистрации на игры.',
            '/cancel — отменить текущий диалог (например, ввод дат).',
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
            // Очищаем все данные и устанавливаем новый источник
            await changeSourceUrl(chatId, pendingUrl);
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

    // Управление пакетами игр и типами
    bot.command('game_packs_management', async (ctx) => {
        const kb = buildGameTypesMenuKeyboard();
        await ctx.reply(
            '📦 Управление пакетами игр\n\n' +
            'Выберите действие:\n\n' +
            '📦 Показать пакеты — список всех пакетов игр с их статусом\n' +
            '🚫 Исключить типы — скрыть определённые типы игр из обработки\n' +
            '♻️ Восстановить типы — вернуть исключённые типы\n' +
            '📋 Список исключённых — показать, какие типы скрыты',
            { reply_markup: kb }
        );
    });

    // Пометить пакет(ы) как сыгранные: текстовый режим, клавиатура, список
    // Управление отметкой «сыграно» с клавиатурой-переключателем
    bot.command('played', async (ctx) => {
        const arg = (ctx.match as string | undefined)?.trim() || '';
        const chatId = getChatId(ctx);
        
        // Без аргумента - показать клавиатуру
        if (!arg) {
            const rows = await getUpcomingGroups(chatId);
            if (!rows.length) return ctx.reply('Пакетов игр не найдено.');
            const kb = buildPlayedKeyboard(rows);
            return ctx.reply(
                '🎮 Управление статусом игр\n\n' +
                'Нажмите на пакет, чтобы переключить статус:\n' +
                '✅ — сыграно\n' +
                '◻️ — не сыграно',
                { reply_markup: kb }
            );
        }

        // "list" - показать списком
        if (arg.toLowerCase() === 'list') {
            const rows = await getUpcomingGroups(chatId);
            const played = rows.filter((r) => r.played);
            const unplayed = rows.filter((r) => !r.played);
            
            let msg = '';
            if (played.length > 0) {
                msg += '✅ Сыграно:\n' + played.map((r) => `  ${r.type_name} #${r.num}`).join('\n');
            }
            if (unplayed.length > 0) {
                if (msg) msg += '\n\n';
                msg += '◻️ Не сыграно:\n' + unplayed.map((r) => `  ${r.type_name} #${r.num}`).join('\n');
            }
            
            if (!msg) msg = 'Пакетов игр не найдено.';
            return ctx.reply(msg);
        }

        // Текстовый режим - список ключей для пометки
        const keys = arg
            .split(/[\s,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (!keys.length) {
            return ctx.reply(
                'Использование команды:\n' +
                '/played — показать клавиатуру\n' +
                '/played list — показать списком\n' +
                '/played КвизПлиз#123 — отметить как сыграно\n' +
                '/played КвизПлиз#123,Караоке#2 — несколько пакетов'
            );
        }

        let marked = 0;
        for (const k of keys) {
            try { 
                await markGroupPlayed(chatId, k); 
                marked++; 
            } catch (e) { 
                log.error('played error for', k, e); 
            }
        }
        await ctx.reply(`✅ Отмечено как сыгранные: ${marked}/${keys.length}.`);
    });

    // Единая команда для создания опросов с меню выбора
    bot.command('polls', async (ctx) => {
        const chatId = getChatId(ctx);
        const rows = await getUpcomingGroups(chatId);
        
        if (!rows.length) {
            return ctx.reply('Пакеты (игры) не обнаружены. Сначала синхронизируйте данные с помощью /sync.');
        }
        
        const kb = buildPollsMainMenuKeyboard();
        await ctx.reply(
            '📊 Создание опросов\n\n' +
            'Выберите способ создания опросов:\n\n' +
            '🎯 По типам игр — выбрать конкретные типы, все игры будут отсортированы по дате\n' +
            '📅 По датам — сгруппировать по периодам времени\n' +
            '📦 По номеру пакета — создать для одного пакета\n' +
            '🌐 Для всех пакетов — создать для всех (где 2+ дат)',
            { reply_markup: kb }
        );
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

    // Команда для ввода информации о команде
    bot.command('team_info', async (ctx) => {
        const chatId = getChatId(ctx);
        const existingInfo = await getTeamInfo(chatId);
        
        if (existingInfo) {
            await ctx.reply(
                '👥 Информация о команде\n\n' +
                `Название команды: ${existingInfo.team_name}\n` +
                `Капитан: ${existingInfo.captain_name}\n` +
                `Email: ${existingInfo.email}\n` +
                `Телефон: ${existingInfo.phone}\n\n` +
                'Для изменения данных отправьте /team_info_edit'
            );
        } else {
            await ctx.reply(
                '👥 Информация о команде не заполнена.\n\n' +
                'Для заполнения отправьте /team_info_edit'
            );
        }
    });

    bot.command('team_info_edit', async (ctx) => {
        const chatId = getChatId(ctx);
        
        log.info(`[Team Info] Starting team info dialog for chat ${chatId}`);
        setConversationState(chatId, 'team_info_name');
        
        await ctx.reply(
            '👥 Заполнение информации о команде\n\n' +
            '📝 Шаг 1/4: Введите название вашей команды:\n\n' +
            '⚠️ В групповом чате: ответьте (reply) на это сообщение\n' +
            'или отправьте /cancel для отмены.'
        );
    });

    // Команда регистрации на игры по результатам опросов
    bot.command('register_from_polls', async (ctx) => {
        const chatId = getChatId(ctx);
        
        // Check if team info is filled
        const teamInfo = await getTeamInfo(chatId);
        if (!teamInfo) {
            return ctx.reply(
                '❌ Сначала заполните информацию о команде.\n\n' +
                'Используйте /team_info_edit для заполнения данных команды.'
            );
        }
        
        // Find unprocessed polls with votes
        const polls = await findUnprocessedPollsWithVotes(chatId);
        
        if (polls.length === 0) {
            return ctx.reply(
                '📊 Нет необработанных опросов с голосами.\n\n' +
                'Создайте опросы с помощью /polls и дождитесь, пока участники проголосуют.'
            );
        }
        
        const pollSelectionItems = await buildPollSelectionItems(chatId, polls);
        
        if (pollSelectionItems.length === 0) {
            return ctx.reply(
                '📊 Нет опросов с явными победителями.\n\n' +
                'Для автоматической регистрации необходимо минимум 2 голоса за один вариант ответа.'
            );
        }
        
        log.info(`[Registration] Chat ${chatId} - found ${pollSelectionItems.length} polls with winners`);
        
        // Clear previous selections
        clearAllRegistrationState(chatId);
        
        // Show poll selection keyboard
        const kb = buildPollSelectionKeyboard(pollSelectionItems, new Set());
        await ctx.reply(
            `📊 Анализ опросов завершён\n\n` +
            `Найдено опросов с победителями: ${pollSelectionItems.length}\n\n` +
            `Выберите опросы для обработки:\n` +
            `(Нужно 2+ голоса за вариант, кроме "Не смогу")`,
            { reply_markup: kb }
        );
    });

    // Команда управления регистрациями
    bot.command('registered', async (ctx) => {
        const chatId = getChatId(ctx);
        const games = await getFilteredUpcoming(chatId);
        
        const registeredGames = games.filter(g => g.registered);
        const allGames = games.map(g => ({
            external_id: g.external_id,
            title: g.title,
            registered: g.registered || false
        }));
        
        if (allGames.length === 0) {
            return ctx.reply('Нет доступных игр.');
        }
        
        const kb = buildRegisteredGamesKeyboard(allGames);
        await ctx.reply(
            `📝 Управление регистрациями\n\n` +
            `Зарегистрировано игр: ${registeredGames.length}\n\n` +
            `Нажмите на игру, чтобы переключить статус регистрации:`,
            { reply_markup: kb }
        );
    });

    // Коллбэки
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data!;
        const chatId = getChatId(ctx);
        try {
            // Game types menu options
            if (data === CB.TYPES_MENU_EXCLUDE) {
                const rows = await getUpcomingGroups(chatId);
                const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
                const excluded = new Set(await listExcludedTypes(chatId));

                if (!allTypes.length) {
                    return await ctx.answerCallbackQuery({ text: 'Пакеты (игры) не обнаружены', show_alert: true });
                }

                const kb = buildTypesKeyboard(allTypes, excluded);
                await ctx.editMessageText(
                    '🚫 Исключение типов игр\n\n' +
                    'Нажмите на тип, чтобы исключить/восстановить его:\n' +
                    '🚫 — активный (будет исключён при нажатии)\n' +
                    '♻️ — исключён (будет восстановлен при нажатии)',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.TYPES_MENU_RESTORE) {
                const excluded = await listExcludedTypes(chatId);
                
                if (!excluded.length) {
                    return await ctx.answerCallbackQuery({ text: 'Нет исключённых типов', show_alert: true });
                }
                
                const kb = buildRestoreTypesKeyboard(excluded);
                await ctx.editMessageText(
                    '♻️ Восстановление типов игр\n\n' +
                    'Нажмите на тип, чтобы восстановить его:',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.TYPES_MENU_SHOW_LIST) {
                const excluded = await listExcludedTypes(chatId);
                
                if (!excluded.length) {
                    await ctx.editMessageText('📋 Список исключённых типов\n\n✅ Нет исключённых типов. Все типы игр активны.');
                } else {
                    const msg = '📋 Список исключённых типов\n\n🚫 Исключено:\n' + 
                                excluded.map((type, i) => `${i + 1}. ${type}`).join('\n');
                    await ctx.editMessageText(msg);
                }
                await ctx.answerCallbackQuery();
            } else if (data === CB.TYPES_MENU_SHOW_PACKS) {
                const rows = await getUpcomingGroups(chatId);
                
                if (!rows.length) {
                    await ctx.editMessageText('📦 Пакеты игр\n\nПакетов игр не найдено.');
                    await ctx.answerCallbackQuery();
                    return;
                }
                
                let msg = '📦 Пакеты игр\n\n';
                msg += rows.map((r, i) => {
                    const name = r.type_name;
                    const n = r.num || '?';
                    let icons = '';
                    if (r.played) icons += '✅ ';
                    if (r.registered_count > 0) icons += '📝 ';
                    if (r.polled_by_package) icons += '🗳 ';
                    if (r.polled_by_date) icons += '📅 ';
                    return `${i + 1}. ${icons}${name} #${n} — дат: ${r.cnt}`;
                }).join('\n');
                
                msg += '\n\n📖 Легенда:\n';
                msg += '✅ — сыграно\n';
                msg += '📝 — зарегистрировано на игру(ы)\n';
                msg += '🗳 — опрос по пакету создан\n';
                msg += '📅 — игра из пакета участвует в опросе по дате';
                
                await ctx.editMessageText(msg);
                await ctx.answerCallbackQuery();
            } else if (data.startsWith(CB.TYPE_RESTORE)) {
                const buttonId = data.slice(CB.TYPE_RESTORE.length);
                const type = resolveButtonId(buttonId);
                if (!type) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                await unexcludeType(chatId, type);
                const excluded = await listExcludedTypes(chatId);
                
                if (excluded.length > 0) {
                    const kb = buildRestoreTypesKeyboard(excluded);
                    await ctx.editMessageReplyMarkup({ reply_markup: kb });
                    await ctx.answerCallbackQuery({ text: `✅ Тип «${type}» восстановлен` });
                } else {
                    await ctx.editMessageText('✅ Все типы игр восстановлены!');
                    await ctx.answerCallbackQuery({ text: `✅ Тип «${type}» восстановлен` });
                }
            } else if (data === CB.POLLS_MENU_BY_TYPES) {
                const rows = await getUpcomingGroups(chatId);
                const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
                
                if (!allTypes.length) {
                    return await ctx.answerCallbackQuery({ text: 'Пакеты не найдены', show_alert: true });
                }
                
                clearSelectedTypes(chatId);
                const kb = buildPollsByTypesKeyboard(allTypes, new Set());
                await ctx.editMessageText(
                    'Выберите типы игр для создания опросов.\n\n' +
                    'Будут созданы опросы со всеми играми выбранных типов, отсортированными по дате.\n\n' +
                    'Нажмите на типы для выбора, затем нажмите "Создать опросы":',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.POLLS_MENU_BY_DATE) {
                const kb = buildPollsByDateKeyboard();
                await ctx.editMessageText(
                    'Создание опросов по играм, сгруппированным по периоду времени.\n\n' +
                    'Будут созданы опросы, где каждый опрос охватывает игры в указанном периоде.\n\n' +
                    'Выберите период:',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.POLLS_MENU_BY_PACKAGE) {
                const rows = await getUpcomingGroups(chatId);
                if (!rows.length) {
                    return await ctx.answerCallbackQuery({ text: 'Пакеты не найдены', show_alert: true });
                }
                
                const packages = rows.map((r, i) => ({
                    index: i + 1,
                    name: r.type_name,
                    num: r.num,
                    count: r.cnt,
                }));
                
                const kb = buildPollsByPackageKeyboard(packages);
                await ctx.editMessageText(
                    '📦 Выберите пакет для создания опроса:\n\n' +
                    'Нажмите на пакет, чтобы создать опрос для всех его дат.',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.POLLS_MENU_ALL) {
                await ctx.answerCallbackQuery({ text: 'Создаю опросы...' });
                await ctx.editMessageText('🔄 Создание опросов для всех пакетов...');
                
                const rows = await getUpcomingGroups(chatId);
                const games = await getFilteredUpcoming(chatId);
                
                let created = 0;
                for (const row of rows) {
                    if (row.polled_by_package) continue;
                    const items = games.filter((g) => g.group_key === row.group_key);
                    if (items.length < 2) continue;
                    const group = { groupKey: row.group_key, name: row.type_name, number: row.num, items };
                    const msg = await postGroupPoll(bot, chatId, group);
                    if (msg) created++;
                }
                
                await ctx.reply(created ? `✅ Опросов создано: ${created}` : 'Нет пакетов (игр) для создания опросов.');
            } else if (data.startsWith(CB.POLLS_BY_PACKAGE)) {
                const idxStr = data.slice(CB.POLLS_BY_PACKAGE.length);
                const idx = parseInt(idxStr, 10);
                
                const rows = await getUpcomingGroups(chatId);
                const row = rows[idx - 1];
                
                if (!row) {
                    return await ctx.answerCallbackQuery({ text: 'Пакет не найден', show_alert: true });
                }
                
                const games = await getFilteredUpcoming(chatId);
                const items = games.filter((g) => g.group_key === row.group_key);
                
                if (!items.length) {
                    return await ctx.answerCallbackQuery({ text: `Нет дат для "${row.type_name} #${row.num}"`, show_alert: true });
                }
                
                await ctx.answerCallbackQuery({ text: 'Создаю опрос...' });
                const group = { groupKey: row.group_key, name: row.type_name, number: row.num, items };
                const msg = await postGroupPoll(bot, chatId, group);
                
                if (msg) {
                    await ctx.reply(`✅ Опрос создан для "${row.type_name} #${row.num}"`);
                } else {
                    await ctx.reply('❌ Ошибка при создании опроса.');
                }
            } else if (data.startsWith(CB.POLLS_BY_TYPE_TOGGLE)) {
                const buttonId = data.slice(CB.POLLS_BY_TYPE_TOGGLE.length);
                const type = resolveButtonId(buttonId);
                if (!type) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                toggleSelectedType(chatId, type);
                const selectedTypes = getSelectedTypes(chatId);
                
                const rows = await getUpcomingGroups(chatId);
                const allTypes = Array.from(new Set(rows.map((r) => String(r.type_name))));
                const kb = buildPollsByTypesKeyboard(allTypes, selectedTypes);
                
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: selectedTypes.has(type) ? `✅ ${type}` : `❌ ${type}` });
            } else if (data === CB.POLLS_BY_TYPE_CREATE) {
                const selectedTypes = getSelectedTypes(chatId);
                if (selectedTypes.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одного типа', show_alert: true });
                }
                
                // Show date filter options
                const kb = buildPollsByTypesDateFilterKeyboard(selectedTypes.size);
                await ctx.editMessageText(
                    `✅ Выбрано типов: ${selectedTypes.size}\n\n` +
                    'Выберите вариант создания опросов:\n\n' +
                    '📅 С фильтром по дате — создать опросы только для игр в указанном периоде\n' +
                    '🌐 Без фильтра — создать опросы для всех игр выбранных типов',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.POLLS_BY_TYPE_WITH_DATE) {
                const selectedTypes = getSelectedTypes(chatId);
                if (selectedTypes.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одного типа', show_alert: true });
                }
                
                // Show date period selection with filtered callbacks
                const kb = buildPollsByDateKeyboard(true);
                await ctx.editMessageText(
                    `📅 Фильтр по дате для ${selectedTypes.size} типов\n\n` +
                    'Выберите период времени для фильтрации игр:',
                    { reply_markup: kb }
                );
                await ctx.answerCallbackQuery();
            } else if (data === CB.POLLS_BY_TYPE_NO_DATE) {
                const selectedTypes = getSelectedTypes(chatId);
                if (selectedTypes.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одного типа', show_alert: true });
                }
                
                await ctx.answerCallbackQuery({ text: 'Создаю опросы...' });
                await ctx.reply(`🔄 Создаю опросы для ${selectedTypes.size} типов игр без фильтра по дате...`);
                
                const games = await getFilteredUpcoming(chatId);
                const filteredGames = filterGamesByTypes(games, selectedTypes);
                const sortedGames = sortGamesByDate(filteredGames);
                
                if (sortedGames.length === 0) {
                    clearSelectedTypes(chatId);
                    return await ctx.reply('Нет игр выбранных типов.');
                }
                
                const created = await createPollsByDatePeriod(bot, chatId, sortedGames, 365);
                
                clearSelectedTypes(chatId);
                await ctx.reply(created ? `✅ Опросов создано: ${created}` : 'Нет подходящих игр для создания опросов.');
            } else if (data.startsWith(CB.POLLS_BY_DATE_FILTERED)) {
                const period = data.slice(CB.POLLS_BY_DATE_FILTERED.length);
                const selectedTypes = getSelectedTypes(chatId);
                
                if (selectedTypes.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одного типа', show_alert: true });
                }
                
                if (period === 'custom') {
                    // Start dialog for custom date input
                    log.info(`[Conversation] Starting custom date dialog for chat ${chatId} with type filter`);
                    setConversationState(chatId, 'waiting_start_date', { filterByTypes: true });
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
                
                await ctx.answerCallbackQuery({ text: 'Создаю опросы...' });
                await ctx.reply(`🔄 Создаю опросы для ${selectedTypes.size} типов за ${days} дней...`);
                
                const games = await getFilteredUpcoming(chatId);
                const filteredGames = filterGamesByTypes(games, selectedTypes);
                const sortedGames = sortGamesByDate(filteredGames);
                
                if (sortedGames.length === 0) {
                    clearSelectedTypes(chatId);
                    return await ctx.reply('Нет игр выбранных типов.');
                }
                
                const created = await createPollsByDatePeriod(bot, chatId, sortedGames, days);
                
                clearSelectedTypes(chatId);
                if (created > 0) {
                    await ctx.reply(`✅ Создано ${created} ${getPollWordForm(created)} для игр выбранных типов на ${days} дней вперёд.`);
                } else {
                    await ctx.reply('Нет игр в выбранном периоде.');
                }
            } else if (data.startsWith(CB.POLLS_BY_DATE)) {
                const period = data.slice(CB.POLLS_BY_DATE.length);
                
                if (period === 'custom') {
                    // Start dialog for custom date input
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
                    await ctx.reply(`✅ Создано ${created} ${getPollWordForm(created)} для игр на ${days} дней вперёд.`);
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
            } else if (data.startsWith(CB.REG_POLL_TOGGLE)) {
                const buttonId = data.slice(CB.REG_POLL_TOGGLE.length);
                const pollId = resolveButtonId(buttonId);
                if (!pollId) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                toggleSelectedPoll(chatId, pollId);
                const selectedPolls = getSelectedPolls(chatId);
                
                // Rebuild keyboard with current selections
                const polls = await findUnprocessedPollsWithVotes(chatId);
                const pollSelectionItems = await buildPollSelectionItems(chatId, polls);
                
                const kb = buildPollSelectionKeyboard(pollSelectionItems, selectedPolls);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: selectedPolls.has(pollId) ? '✅ Выбрано' : '❌ Снято' });
            } else if (data === CB.REG_POLL_CONFIRM) {
                const selectedPolls = getSelectedPolls(chatId);
                if (selectedPolls.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одного опроса', show_alert: true });
                }
                
                await ctx.answerCallbackQuery({ text: 'Анализирую...' });
                await ctx.reply(`🔍 Анализирую ${selectedPolls.size} опросов...`);
                
                // Collect all winning games from selected polls
                const winningGames: Array<{ external_id: string; title: string; date: string; venue: string; vote_count: number; url: string }> = [];
                const gameVoteMap = new Map<string, number>();
                
                for (const pollId of selectedPolls) {
                    const optionVotes = await getPollOptionVotes(pollId);
                    
                    // Find max vote count (excluding unavailable)
                    const validOptions = optionVotes.filter(opt => !opt.is_unavailable && opt.game_external_id);
                    const maxVotes = Math.max(...validOptions.map(opt => opt.vote_count), 0);
                    
                    // Get all options with max votes (can be multiple winners)
                    const winners = validOptions.filter(opt => opt.vote_count === maxVotes && opt.vote_count >= 1);
                    
                    for (const winner of winners) {
                        if (!winner.game_external_id) continue;
                        
                        const game = await getGameByExternalId(chatId, winner.game_external_id);
                        if (!game) continue;
                        
                        // Skip past games
                        if (new Date(game.date_time) < new Date()) continue;
                        
                        // Skip already registered games
                        if (game.registered) continue;
                        
                        const { dd, mm, hh, mi } = formatGameDateTime(game.date_time);
                        winningGames.push({
                            external_id: game.external_id,
                            title: game.title,
                            date: `${dd}.${mm} ${hh}:${mi}`,
                            venue: game.venue || '',
                            vote_count: winner.vote_count,
                            url: game.url
                        });
                        
                        gameVoteMap.set(game.external_id, winner.vote_count);
                    }
                }
                
                if (winningGames.length === 0) {
                    clearAllRegistrationState(chatId);
                    return await ctx.reply('❌ Не найдено побед ителей среди выбранных опросов или все игры уже в прошлом/зарегистрированы.');
                }
                
                // Store game-vote mapping
                setPollGameMapping(chatId, gameVoteMap);
                
                // Show game selection keyboard
                const kb = buildGameSelectionKeyboard(winningGames, new Set());
                await ctx.reply(
                    `🎯 Найдено игр-победителей: ${winningGames.length}\n\n` +
                    `Выберите игры для регистрации команды:`,
                    { reply_markup: kb }
                );
            } else if (data.startsWith(CB.REG_GAME_TOGGLE)) {
                const buttonId = data.slice(CB.REG_GAME_TOGGLE.length);
                const gameExternalId = resolveButtonId(buttonId);
                if (!gameExternalId) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                toggleSelectedGame(chatId, gameExternalId);
                const selectedGames = getSelectedGames(chatId);
                
                // Get current winning games to rebuild keyboard
                // (we need to re-fetch this data - in production, consider caching)
                const selectedPolls = getSelectedPolls(chatId);
                const winningGames = [];
                const gameVoteMap = new Map<string, number>();
                
                for (const pollId of selectedPolls) {
                    const optionVotes = await getPollOptionVotes(pollId);
                    const validOptions = optionVotes.filter(opt => !opt.is_unavailable && opt.game_external_id);
                    const maxVotes = Math.max(...validOptions.map(opt => opt.vote_count), 0);
                    const winners = validOptions.filter(opt => opt.vote_count === maxVotes && opt.vote_count >= 2);
                    
                    for (const winner of winners) {
                        if (!winner.game_external_id) continue;
                        const game = await getGameByExternalId(chatId, winner.game_external_id);
                        if (!game || new Date(game.date_time) < new Date() || game.registered) continue;
                        
                        const { dd, mm, hh, mi } = formatGameDateTime(game.date_time);
                        winningGames.push({
                            external_id: game.external_id,
                            title: game.title,
                            date: `${dd}.${mm} ${hh}:${mi}`,
                            venue: game.venue || '',
                            vote_count: winner.vote_count,
                            url: game.url
                        });
                        gameVoteMap.set(game.external_id, winner.vote_count);
                    }
                }
                
                const kb = buildGameSelectionKeyboard(winningGames, selectedGames);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: selectedGames.has(gameExternalId) ? '✅ Выбрано' : '❌ Снято' });
            } else if (data === CB.REG_GAME_CONFIRM) {
                const selectedGames = getSelectedGames(chatId);
                if (selectedGames.size === 0) {
                    return await ctx.answerCallbackQuery({ text: 'Не выбрано ни одной игры', show_alert: true });
                }
                
                await ctx.answerCallbackQuery({ text: 'Начинаю регистрацию...' });
                await ctx.reply(`🎮 Регистрирую команду на ${selectedGames.size} игр...`);
                
                const teamInfo = await getTeamInfo(chatId);
                if (!teamInfo) {
                    clearAllRegistrationState(chatId);
                    return await ctx.reply('❌ Информация о команде не найдена. Используйте /team_info_edit.');
                }
                
                const gameVoteMap = getPollGameMapping(chatId);
                let registered = 0;
                let failed = 0;
                const selectedPolls = getSelectedPolls(chatId);
                
                for (const gameExternalId of selectedGames) {
                    const game = await getGameByExternalId(chatId, gameExternalId);
                    if (!game) {
                        failed++;
                        continue;
                    }
                    
                    const voteCount = gameVoteMap.get(gameExternalId) || 2;
                    
                    log.info(`[Registration] Registering for game: ${game.title}, players: ${voteCount}`);
                    
                    const result = await registerForGame({
                        gameUrl: game.url,
                        teamInfo,
                        playerCount: voteCount
                    });
                    
                    if (result.success) {
                        await markGameRegistered(chatId, gameExternalId);
                        registered++;
                        log.info(`[Registration] Successfully registered for: ${game.title}`);
                    } else {
                        failed++;
                        log.error(`[Registration] Failed to register for: ${game.title}`, result.error);
                    }
                    
                    // Small delay between registrations
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                // Mark processed polls
                for (const pollId of selectedPolls) {
                    await markPollProcessedForRegistration(pollId);
                }
                
                clearAllRegistrationState(chatId);
                
                await ctx.reply(
                    `✅ Регистрация завершена!\n\n` +
                    `Успешно: ${registered}\n` +
                    `Ошибок: ${failed}\n\n` +
                    `Опросов обработано: ${selectedPolls.size}\n\n` +
                    `Используйте /registered для управления статусами регистрации.`
                );
            } else if (data.startsWith(CB.REGISTERED_MARK)) {
                const buttonId = data.slice(CB.REGISTERED_MARK.length);
                const gameExternalId = resolveButtonId(buttonId);
                if (!gameExternalId) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                await markGameRegistered(chatId, gameExternalId);
                
                const games = await getFilteredUpcoming(chatId);
                const allGames = games.map(g => ({
                    external_id: g.external_id,
                    title: g.title,
                    registered: g.registered || false
                }));
                
                const kb = buildRegisteredGamesKeyboard(allGames);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: '✅ Отмечено как зарегистрировано' });
            } else if (data.startsWith(CB.REGISTERED_UNMARK)) {
                const buttonId = data.slice(CB.REGISTERED_UNMARK.length);
                const gameExternalId = resolveButtonId(buttonId);
                if (!gameExternalId) return await ctx.answerCallbackQuery({ text: 'Ошибка: кнопка устарела' });
                
                await unmarkGameRegistered(chatId, gameExternalId);
                
                const games = await getFilteredUpcoming(chatId);
                const allGames = games.map(g => ({
                    external_id: g.external_id,
                    title: g.title,
                    registered: g.registered || false
                }));
                
                const kb = buildRegisteredGamesKeyboard(allGames);
                await ctx.editMessageReplyMarkup({ reply_markup: kb });
                await ctx.answerCallbackQuery({ text: '❌ Снята отметка регистрации' });
            }
        } catch (e) {
            log.error('Callback error:', e);
            await ctx.answerCallbackQuery({ text: 'Ошибка, см. логи', show_alert: true });
        }
    });

    bot.on('poll_answer', async (ctx) => {
        const pollAnswer = ctx.update.poll_answer;
        if (!pollAnswer.user) return;
        await handlePollAnswer(pollAnswer as { poll_id: string; user: { id: number }; option_ids: number[] });
    });

    // Handle text messages for custom date dialog
    bot.on('message:text', async (ctx, next) => {
        const chatId = getChatId(ctx);
        const text = ctx.message.text;
        
        // Pass commands to command handlers
        if (text.startsWith('/')) {
            await next();
            return;
        }
        
        const state = getConversationState(chatId);
        
        if (!state) return; // No active dialog
        
        // In groups, check if this is a reply to bot
        if (ctx.chat?.type !== 'private') {
            const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
            if (!isReplyToBot) {
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
                
                // Check that date is not in the past
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                if (startDate < now) {
                    log.warn(`[Conversation] Start date is in the past: ${startDate}`);
                    await ctx.reply('❌ Дата начала не может быть в прошлом. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                // Save start date and ask for end date
                log.info(`[Conversation] Start date accepted: ${formatDateForDisplay(startDate)}`);
                const filterByTypes = state.data?.filterByTypes || false;
                setConversationState(chatId, 'waiting_end_date', { 
                    startDate: startDate.toISOString(),
                    filterByTypes 
                });
                
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
                
                // Check that end date is after start date
                if (!validateDateRange(startDate, endDate)) {
                    log.warn(`[Conversation] End date ${formatDateForDisplay(endDate)} is not after start date ${formatDateForDisplay(startDate)}`);
                    await ctx.reply(`❌ Дата окончания должна быть позже даты начала (${formatDateForDisplay(startDate)}). Попробуйте снова или отправьте /cancel для отмены.`);
                    return;
                }
                
                // Create polls
                log.info(`[Conversation] Creating polls for date range: ${formatDateForDisplay(startDate)} - ${formatDateForDisplay(endDate)}`);
                const filterByTypes = state.data?.filterByTypes || false;
                clearConversationState(chatId);
                
                await ctx.reply(`⏳ Создаю опросы для периода с ${formatDateForDisplay(startDate)} по ${formatDateForDisplay(endDate)}...`);
                
                let games = await getFilteredUpcoming(chatId);
                
                // Filter by selected types if flag is set
                if (filterByTypes) {
                    const selectedTypes = getSelectedTypes(chatId);
                    games = filterGamesByTypes(games, selectedTypes);
                    
                    if (games.length === 0) {
                        clearSelectedTypes(chatId);
                        return await ctx.reply('❌ Нет игр выбранных типов в указанном периоде.');
                    }
                }
                
                const created = await createPollsByDateRange(bot, chatId, games, startDate, endDate);
                
                if (filterByTypes) {
                    clearSelectedTypes(chatId);
                }
                
                if (created > 0) {
                    const suffix = filterByTypes ? ' для игр выбранных типов' : '';
                    await ctx.reply(`✅ Создано ${created} ${getPollWordForm(created)} для игр с ${formatDateForDisplay(startDate)} по ${formatDateForDisplay(endDate)}${suffix}.`);
                } else {
                    await ctx.reply('❌ Нет игр в выбранном периоде.');
                }
            } else if (state.step === 'team_info_name') {
                const teamName = text.trim();
                if (!teamName || teamName.length < 2) {
                    await ctx.reply('❌ Название команды слишком короткое. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                log.info(`[Team Info] Chat ${chatId} - team name accepted: ${teamName}`);
                setConversationState(chatId, 'team_info_captain', { team_name: teamName });
                
                await ctx.reply(
                    `✅ Название команды: ${teamName}\n\n` +
                    '📝 Шаг 2/4: Введите имя капитана команды:'
                );
            } else if (state.step === 'team_info_captain') {
                const captainName = text.trim();
                if (!captainName || captainName.length < 2) {
                    await ctx.reply('❌ Имя капитана слишком короткое. Попробуйте снова или отправьте /cancel для отмены.');
                    return;
                }
                
                log.info(`[Team Info] Chat ${chatId} - captain name accepted: ${captainName}`);
                setConversationState(chatId, 'team_info_email', { 
                    team_name: state.data.team_name,
                    captain_name: captainName 
                });
                
                await ctx.reply(
                    `✅ Капитан: ${captainName}\n\n` +
                    '📝 Шаг 3/4: Введите email команды:\n' +
                    'Например: team@example.com'
                );
            } else if (state.step === 'team_info_email') {
                const email = text.trim();
                if (!isValidEmail(email)) {
                    await ctx.reply('❌ Некорректный email. Пожалуйста, введите корректный email (например: team@example.com) или отправьте /cancel для отмены.');
                    return;
                }
                
                log.info(`[Team Info] Chat ${chatId} - email accepted: ${email}`);
                setConversationState(chatId, 'team_info_phone', { 
                    team_name: state.data.team_name,
                    captain_name: state.data.captain_name,
                    email 
                });
                
                await ctx.reply(
                    `✅ Email: ${email}\n\n` +
                    '📝 Шаг 4/4: Введите номер телефона капитана:\n' +
                    'Можно в любом формате: +79991234567, 8-999-123-45-67, 9991234567'
                );
            } else if (state.step === 'team_info_phone') {
                const normalizedPhone = validateAndNormalizePhone(text);
                if (!normalizedPhone) {
                    await ctx.reply('❌ Некорректный номер телефона. Пожалуйста, введите корректный номер (например: +79991234567 или 89991234567) или отправьте /cancel для отмены.');
                    return;
                }
                
                log.info(`[Team Info] Chat ${chatId} - phone accepted: ${normalizedPhone}`);
                
                const teamInfo: TeamInfo = {
                    team_name: state.data.team_name,
                    captain_name: state.data.captain_name,
                    email: state.data.email,
                    phone: normalizedPhone
                };
                
                clearConversationState(chatId);
                
                try {
                    await saveTeamInfo(chatId, teamInfo);
                    await ctx.reply(
                        '✅ Информация о команде сохранена!\n\n' +
                        `Название команды: ${teamInfo.team_name}\n` +
                        `Капитан: ${teamInfo.captain_name}\n` +
                        `Email: ${teamInfo.email}\n` +
                        `Телефон: ${teamInfo.phone}\n\n` +
                        'Для просмотра используйте /team_info\n' +
                        'Для изменения — /team_info_edit'
                    );
                } catch (e) {
                    log.error('[Team Info] Save error:', e);
                    await ctx.reply('❌ Ошибка при сохранении данных. См. логи.');
                }
            }
        } catch (e) {
            log.error('[Conversation] Error:', e);
            clearConversationState(chatId);
            await ctx.reply('❌ Произошла ошибка. Диалог отменён.');
        }
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
