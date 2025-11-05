import { Bot } from 'grammy';
import { config } from '../config.js';
import { insertPoll, mapPollOption, markGroupProcessed } from '../db/repositories.js';
import { Group } from '../types.js';

// Заголовок: "Квиз Плиз. <NAME> #<NUMBER>"
// Для "Квиз, плиз!" добавляем приписку "(Классика)"
function makePollTitle(g: Group) {
    const classicBase = /^Квиз\s*,?\s*плиз!?$/i.test(g.name.replace(/!+$/,'').trim());
    const base = classicBase ? `${g.name} (Классика)` : g.name;
    return `Квиз Плиз. ${base} #${g.number}`;
}

export async function postGroupPoll(bot: Bot, group: Group) {
    const options = group.items.map((g: any) => {
        const dt = new Date(g.date_time);
        const pad = (n: number) => String(n).padStart(2, '0');
        const dd = pad(dt.getDate());
        const mm = pad(dt.getMonth() + 1);
        const hh = pad(dt.getHours());
        const mi = pad(dt.getMinutes());
        const place = g.venue ?? '';
        // Формат: "4 ноября в 16:00 Chesterfield Bar" → используем ДД.ММ для краткости
        return `${dd}.${mm} в ${hh}:${mi} ${place}`.trim();
    });

    // Добавляем обязательный вариант
    options.push('Не смогу ни в один из дней');

    const title = makePollTitle(group);

    const msg = await bot.api.sendPoll(
        config.chatId,
        title,
        options,
        {
            is_anonymous: false,
            allows_multiple_answers: true,
        }
    );

    // Сохраняем poll + соответствия опций
    await insertPoll(msg.poll!.id, String(msg.chat.id), msg.message_id, group.groupKey);
    for (let i = 0; i < group.items.length; i++) {
        await mapPollOption(msg.poll!.id, i, group.items[i].externalId, false);
    }
    // последний — "Не смогу ни в один из дней"
    await mapPollOption(msg.poll!.id, options.length - 1, null, true);

    // Помечаем выпуск обработанным
    await markGroupProcessed(group.groupKey);

    return msg;
}
