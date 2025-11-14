import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import 'dayjs/locale/ru.js';

dayjs.extend(utc as any);
dayjs.extend(timezone as any);
dayjs.locale('ru');

const MOSCOW_TZ = 'Europe/Moscow';

/**
 * Pads a number with leading zero to 2 digits
 * @param n - The number to pad
 * @returns Padded string (e.g., 5 -> "05", 12 -> "12")
 */
export function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * Formats a game date/time for display in Moscow timezone
 * @param dateTime - Date object or date string
 * @returns Object with formatted date parts
 */
export function formatGameDateTime(dateTime: Date | string) {
    const dt = dayjs(dateTime).tz(MOSCOW_TZ);
    return {
        dd: pad(dt.date()),
        mm: pad(dt.month() + 1),
        yyyy: dt.year(),
        hh: pad(dt.hour()),
        mi: pad(dt.minute()),
    };
}
