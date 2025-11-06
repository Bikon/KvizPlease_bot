import { Bot } from 'grammy';

import { insertPoll, mapPollOption, upsertVote } from '../db/repositories.js';
import { formatGameDateTime } from '../utils/dateFormatter.js';

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

    await insertPoll(msg.poll!.id, String(msg.chat.id), msg.message_id, group.groupKey);

    for (let i = 0; i < group.items.length; i++) {
        await mapPollOption(msg.poll!.id, i, group.items[i].external_id, false);
    }
    await mapPollOption(msg.poll!.id, options.length - 1, null, true);

    return msg;
}

export async function handlePollAnswer(pollAnswer: any) {
    const pollId = pollAnswer.poll.id as string;
    const userId = pollAnswer.user.id as number;
    const optionIds = pollAnswer.option_ids as number[];
    await upsertVote(pollId, userId, optionIds);
}

export async function createPollsByDatePeriod(bot: Bot, chatId: string | number, games: any[], periodDays: number): Promise<number> {
    if (!games.length) return 0;
    
    const now = new Date();
    const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
    
    // Фильтруем игры в пределах периода
    const gamesInPeriod = games.filter(g => {
        const gameDate = new Date(g.date_time);
        return gameDate >= now && gameDate <= endDate;
    });
    
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
            ? `Игры с ${formatDate(now)} по ${formatDate(endDate)} (${chunkNum}/${totalChunks})`
            : `Игры с ${formatDate(now)} по ${formatDate(endDate)}`;
        
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
        
        await insertPoll(msg.poll!.id, String(msg.chat.id), msg.message_id);
        
        for (let j = 0; j < chunk.length; j++) {
            await mapPollOption(msg.poll!.id, j, chunk[j].external_id, false);
        }
        await mapPollOption(msg.poll!.id, options.length - 1, null, true);
        
        pollsCreated++;
    }
    
    return pollsCreated;
}
