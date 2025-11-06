import { Bot } from 'grammy';
import { config } from '../config.js';
import { insertPoll, mapPollOption, upsertVote } from '../db/repositories.js';

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
        const dt = new Date(g.date_time);
        const pad = (n: number) => String(n).padStart(2, '0');
        const dd = pad(dt.getDate());
        const mm = pad(dt.getMonth() + 1);
        const hh = pad(dt.getHours());
        const mi = pad(dt.getMinutes());
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
