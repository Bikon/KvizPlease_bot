import dayjs from 'dayjs';
import utc from 'dayjs-plugin-utc';
import tz from 'dayjs-plugin-timezone';
import { RawGame, Game } from '../types.js';

(dayjs as any).extend(utc);
(dayjs as any).extend(tz);

const MOSCOW_TZ = 'Europe/Moscow';

export function normalize(raw: RawGame): Game | null {
  const { date, time, ...rest } = raw;

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
    const cand = (dayjs as any).tz(combined, f, 'ru', MOSCOW_TZ);
    if (cand.isValid()) { dt = cand; break; }
  }
  if (!dt) return null;

  let groupKey: string | undefined;
  if ((rest as any).gameType && (rest as any).gameNumber) {
    groupKey = `${(rest as any).gameType}#${(rest as any).gameNumber}`;
  } else if ((rest as any).title) {
    const m2 = String((rest as any).title).match(/^(.*?)\s*#(\d+)/);
    if (m2) groupKey = `${m2[1].trim()}#${m2[2]}`;
  }

  return {
    externalId: (rest as any).externalId,
    title: (rest as any).title,
    dateTime: dt.toDate(),
    venue: (rest as any).venue,
    district: (rest as any).district,
    address: (rest as any).address,
    price: (rest as any).price,
    difficulty: (rest as any).difficulty,
    status: (rest as any).status,
    url: (rest as any).url,
    groupKey,
  };
}
