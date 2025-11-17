import type { Game, RawGame } from '../types.js';

// Маппинг русских названий месяцев на номера (1-12)
const MONTH_MAP: Record<string, number> = {
    'январь': 1, 'января': 1,
    'февраль': 2, 'февраля': 2,
    'март': 3, 'марта': 3,
    'апрель': 4, 'апреля': 4,
    'май': 5, 'мая': 5,
    'июнь': 6, 'июня': 6,
    'июль': 7, 'июля': 7,
    'август': 8, 'августа': 8,
    'сентябрь': 9, 'сентября': 9,
    'октябрь': 10, 'октября': 10,
    'ноябрь': 11, 'ноября': 11,
    'декабрь': 12, 'декабря': 12,
};

// Создаёт Date объект из московского времени (UTC+3)
// Принимает компоненты даты как если бы они были в московском времени
// Возвращает Date объект (который хранится в UTC внутри)
function createMoscowDate(year: number, month: number, day: number, hour: number, minute: number): Date {
    // Создаём дату как если бы она была в UTC
    // Затем вычитаем 3 часа (Moscow = UTC+3) чтобы получить правильный UTC момент времени
    // Например: "18 ноября 20:00" в Moscow = "18 ноября 17:00" в UTC
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
    // Вычитаем 3 часа (3 * 60 * 60 * 1000 миллисекунд)
    return new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
}

// Пытаемся распарсить «14 ноября, чт • 19:30» и т.п.
export function normalize(raw: RawGame): Game | null {
    const { date, time, ...rest } = raw;
    const combined = `${date} ${time ?? ''}`.trim();

    if (!combined) {
        return null;
    }

    // Очищаем строку от лишних символов
    const cleaned = combined
        .replace(/\s+в\s+/gi, ' ')
        .replace(/[•·]/g, ' ')
        .replace(/,\s*(пн|вт|ср|чт|пт|сб|вс)\s*/gi, ', ')
        .replace(/\s+(пн|вт|ср|чт|пт|сб|вс)\s+/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    let day: number | null = null;
    let month: number | null = null;
    let year: number | null = null;
    let hour: number | null = null;
    let minute: number | null = null;

    // Пробуем формат DD.MM.YYYY HH:mm
    const format1 = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (format1) {
        day = parseInt(format1[1], 10);
        month = parseInt(format1[2], 10);
        year = parseInt(format1[3], 10);
        hour = parseInt(format1[4], 10);
        minute = parseInt(format1[5], 10);
    } else {
        // Пробуем формат YYYY-MM-DD HH:mm
        const format2 = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
        if (format2) {
            year = parseInt(format2[1], 10);
            month = parseInt(format2[2], 10);
            day = parseInt(format2[3], 10);
            hour = parseInt(format2[4], 10);
            minute = parseInt(format2[5], 10);
        } else {
            // Пробуем формат DD.MM HH:mm (без года)
            const format3 = cleaned.match(/^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
            if (format3) {
                day = parseInt(format3[1], 10);
                month = parseInt(format3[2], 10);
                hour = parseInt(format3[3], 10);
                minute = parseInt(format3[4], 10);
            } else {
                // Пробуем текстовый формат: "18 ноября 20:00" или "18 ноября, чт 20:00"
                const dayMatch = cleaned.match(/^(\d{1,2})/);
                if (dayMatch) {
                    day = parseInt(dayMatch[1], 10);
                }

                // Ищем месяц в MONTH_MAP
                for (const [monthName, monthNum] of Object.entries(MONTH_MAP)) {
                    if (cleaned.toLowerCase().includes(monthName.toLowerCase())) {
                        month = monthNum;
                        break;
                    }
                }

                // Ищем время
                const timeMatch = cleaned.match(/(\d{1,2}):(\d{2})/);
                if (timeMatch) {
                    hour = parseInt(timeMatch[1], 10);
                    minute = parseInt(timeMatch[2], 10);
                }
            }
        }
    }

    // Проверяем, что все необходимые компоненты найдены
    if (day === null || month === null || hour === null || minute === null) {
        return null;
    }

    // Валидация компонентов
    if (day < 1 || day > 31 || month < 1 || month > 12 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    // Если год не указан, определяем его на основе сравнения месяцев
    if (year === null) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // getMonth() возвращает 0-11, нам нужно 1-12

        // Если месяц >= текущего месяца, используем текущий год
        // Если месяц < текущего месяца, используем следующий год
        year = month >= currentMonth ? currentYear : currentYear + 1;
    }

    // Создаём дату
    let dateTime: Date;
    try {
        dateTime = createMoscowDate(year, month, day, hour, minute);

        // Проверяем, что дата валидна
        if (isNaN(dateTime.getTime())) {
            return null;
        }
    } catch (e) {
        return null;
    }

    return {
        externalId: rest.externalId,
        title: rest.title,
        dateTime,
        venue: rest.venue,
        district: rest.district,
        address: rest.address,
        price: rest.price,
        difficulty: rest.difficulty,
        status: rest.status,
        url: rest.url,
    };
}
