import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import 'dayjs/locale/ru.js';
import { RawGame, Game } from '../types.js';

dayjs.extend(customParseFormat);
dayjs.locale('ru');

// нормализация имени для ключа группы
function normalizeName(name: string): string {
    return name.replace(/\s+/g, ' ').replace(/!+$/,'').trim();
}

export function normalize(raw: RawGame): Game | null {
    const { date, time, gameType, gameNumber, ...rest } = raw;
    const timeClean = time ? time.replace(/^в\s*/i, '') : '';
    const combined = `${date} ${timeClean}`.trim();

    const formats = [
        'D MMMM HH:mm',
        'D MMMM, ddd HH:mm',
        'DD.MM.YYYY HH:mm',
        'DD.MM HH:mm',
        'YYYY-MM-DD HH:mm',
        'D MMM HH:mm'
    ];

    let dt: dayjs.Dayjs | null = null;
    for (const f of formats) {
        const cand = dayjs(combined, f, 'ru', true);
        if (cand.isValid()) { dt = cand; break; }
    }
    if (!dt || !gameType || !gameNumber) return null;

    const name = normalizeName(gameType);
    const number = String(gameNumber);
    const groupKey = `${name}#${number}`;

    return {
        externalId: rest.externalId,
        title: rest.title,
        dateTime: dt.toDate(),
        venue: rest.venue,
        district: rest.district,
        address: rest.address,
        price: rest.price,
        difficulty: rest.difficulty,
        status: rest.status,
        url: rest.url,
        groupKey,
        name,
        number
    };
}
