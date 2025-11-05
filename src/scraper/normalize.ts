import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import 'dayjs/locale/ru.js';

import type { RawGame, Game } from '../types.js';

dayjs.extend(customParseFormat as any);
dayjs.extend(utc as any);
dayjs.extend(timezone as any);
dayjs.locale('ru');

const MOSCOW_TZ = 'Europe/Moscow';

// Пытаемся распарсить «14 ноября, чт • 19:30» и т.п.
export function normalize(raw: RawGame): Game | null {
    const { date, time, ...rest } = raw;
    const combined = `${date} ${time ?? ''}`.trim();

    const formats = [
        'D MMMM HH:mm',
        'D MMMM, ddd HH:mm',
        'DD.MM.YYYY HH:mm',
        'DD.MM HH:mm',
        'YYYY-MM-DD HH:mm',
        'D MMM HH:mm',
    ];

    let dt: dayjs.Dayjs | null = null;
    for (const f of formats) {
        // В dayjs.tz максимум 3 аргумента: (dateString, format?, timezone?)
        const cand = dayjs.tz(combined, f, MOSCOW_TZ);
        if (cand.isValid()) { dt = cand; break; }
    }

    if (!dt) return null;

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
    };
}
