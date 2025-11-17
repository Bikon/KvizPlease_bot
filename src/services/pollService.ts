import { Bot } from 'grammy';

import { insertPoll, mapPollOption, pollExists, upsertVote } from '../db/repositories.js';
import { formatGameDateTime } from '../utils/dateFormatter.js';
import { log } from '../utils/logger.js';

// Нейминг опросов:
// - Классика: "Квиз, плиз (Классика) #1217"
// - Остальные: "Квиз Плиз. [music party] 2000-е #7"
export function buildPollTitle(groupName: string, number: string) {
    const isClassic = /^Квиз\s*,?\s*плиз!?$/i.test(groupName.replace(/!+$/,'').trim());
    if (isClassic) return `Квиз, плиз (Классика) #${number}`;
    return `Квиз Плиз. ${groupName} #${number}`;
}

export async function postGroupPoll(bot: Bot, chatId: string | number, group: { groupKey: string; name: string; number: string; items: any[] }) {
    if (!group.items.length) return null;

    const options = group.items.map((g) => {
        const { dd, mm, hh, mi } = formatGameDateTime(g.date_time);
        const place = g.venue ?? '';
        return `${dd}.${mm} в ${hh}:${mi} ${place}`.trim();
    });
    options.push('Не смогу ни в один из дней');

    const title = buildPollTitle(group.name, group.number);

    const msg = await bot.api.sendPoll(chatId, title, options, {
        is_anonymous: false,
        allows_multiple_answers: true,
    });

    await insertPoll(msg.poll!.id, String(msg.chat.id), msg.message_id, group.groupKey, msg.poll?.question ?? null);

    for (let i = 0; i < group.items.length; i++) {
        await mapPollOption(msg.poll!.id, i, group.items[i].external_id, false);
    }
    await mapPollOption(msg.poll!.id, options.length - 1, null, true);

    return msg;
}

export async function handlePollAnswer(pollAnswer: any) {
    const pollId = pollAnswer.poll_id as string;
    const user = pollAnswer.user;
    const userId = user.id as number;
    const optionIds = pollAnswer.option_ids as number[];
    const userNameParts = [user.username ? `@${user.username}` : null, user.first_name, user.last_name].filter(Boolean);
    const displayName = userNameParts.join(' ') || `user_${userId}`;
    const exists = await pollExists(pollId);
    if (!exists) {
        log.warn(`[Polls] Received vote for unknown poll ${pollId}, ignoring`);
        return;
    }
    await upsertVote(pollId, userId, optionIds, displayName);
}

export async function createPollsByDateRange(bot: Bot, chatId: string | number, games: any[], startDate: Date, endDate: Date): Promise<number> {
    if (!games.length) return 0;

    // Нормализуем даты: начало дня для startDate, конец дня для endDate
    // Используем UTC для консистентности с данными из БД
    const rangeStart = new Date(Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate(),
        0, 0, 0, 0
    ));
    const rangeEnd = new Date(Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate(),
        23, 59, 59, 999
    ));

    // Фильтруем игры в пределах периода
    const gamesInPeriod = games.filter(g => {
        const gameDate = new Date(g.date_time);
        const gameTime = gameDate.getTime();
        return gameTime >= rangeStart.getTime() && gameTime <= rangeEnd.getTime();
    });

    if (gamesInPeriod.length === 0) {
        log.warn(`[Polls] No games found in range ${rangeStart.toISOString()} to ${rangeEnd.toISOString()} (total games: ${games.length})`);
    }
    
    if (!gamesInPeriod.length) return 0;
    
    // Сортируем по дате
    const sortedGames = gamesInPeriod.sort((a, b) => 
        new Date(a.date_time).getTime() - new Date(b.date_time).getTime()
    );
    
    const formatDate = (d: Date) => {
        const { dd, mm } = formatGameDateTime(d);
        return `${dd}.${mm}`;
    };
    
    // Разбиваем на чанки по 9 игр (оставляем место для "не смогу")
    const chunkSize = 9;
    let pollsCreated = 0;
    
    for (let i = 0; i < sortedGames.length; i += chunkSize) {
        const chunk = sortedGames.slice(i, i + chunkSize);
        
        // Формируем название периода с указанием части, если больше одного опроса
        const totalChunks = Math.ceil(sortedGames.length / chunkSize);
        const chunkNum = Math.floor(i / chunkSize) + 1;
        const periodTitle = totalChunks > 1 
            ? `Игры с ${formatDate(startDate)} по ${formatDate(endDate)} (${chunkNum}/${totalChunks})`
            : `Игры с ${formatDate(startDate)} по ${formatDate(endDate)}`;
        
        // Формируем варианты ответов
        const options = chunk.map((g) => {
            const { dd, mm, hh, mi } = formatGameDateTime(g.date_time);
            const venue = g.venue ?? '';
            const title = g.title.length > 50 ? g.title.substring(0, 47) + '...' : g.title;
            return `${dd}.${mm} ${hh}:${mi} - ${title} (${venue})`.trim();
        });
        
        options.push('Не смогу ни в один из дней');
        
        const msg = await bot.api.sendPoll(chatId, periodTitle, options, {
            is_anonymous: false,
            allows_multiple_answers: true,
        });
        
        await insertPoll(msg.poll!.id, String(msg.chat.id), msg.message_id, null, msg.poll?.question ?? null);
        
        for (let j = 0; j < chunk.length; j++) {
            await mapPollOption(msg.poll!.id, j, chunk[j].external_id, false);
        }
        await mapPollOption(msg.poll!.id, options.length - 1, null, true);
        
        pollsCreated++;
    }
    
    return pollsCreated;
}

/**
 * Creates polls for games within a specified number of days from now
 * This is a convenience wrapper around createPollsByDateRange
 */
export async function createPollsByDatePeriod(bot: Bot, chatId: string | number, games: any[], periodDays: number): Promise<number> {
    const now = new Date();
    const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
    return createPollsByDateRange(bot, chatId, games, now, endDate);
}
