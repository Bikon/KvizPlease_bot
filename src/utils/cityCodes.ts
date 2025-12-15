/**
 * City code mapping from cities.txt
 * Format: "code — City Name"
 * Some cities may not have matches
 */
export const CITY_CODES: Record<number, string> = {
    1: 'Хабаровск',
    2: 'Владивосток',
    3: 'Уфа',
    4: 'Москва',
    5: 'Новосибирск',
    6: 'Челябинск',
    7: 'Екатеринбург',
    8: 'Чебоксары',
    9: 'Нижний Новгород',
    10: 'Набережные Челны',
    11: 'Санкт-Петербург',
    12: 'Уссурийск',
    13: 'Ростов-на-Дону',
    14: 'Магадан',
    15: 'Казань',
    16: 'Стерлитамак',
    17: 'Самара',
    18: 'Тюмень',
    19: 'Ставрополь',
    20: 'Нью-Йорк',
    21: 'Курган',
    22: 'Таганрог',
    23: 'Псков',
    24: 'Южно-Сахалинск',
    25: 'Барнаул',
    26: 'Тель-Авив',
    27: 'Кемерово',
    28: 'Петропавловск-Камчатский',
    29: 'Астана',
    30: 'Владимир',
    31: 'Краснодар',
    32: 'Калуга',
    34: 'Благовещенск',
    35: 'Красноярск',
    36: 'Лондон',
    37: 'Пермь',
    38: 'Беэр-Шева',
    39: 'Рязань',
    40: 'Находка',
    41: 'Улан-Удэ',
    43: 'Алматы',
    44: 'Обнинск',
    45: 'Ижевск',
    46: 'Воткинск',
    47: 'Йошкар-Ола',
    48: 'Нижнекамск',
    49: 'Торонто',
    50: 'Брест',
    51: 'Волгодонск',
    52: 'Рига',
    53: 'Нефтекамск',
    54: 'Бостон',
    55: 'Новочеркасск',
    56: 'Иркутск',
    57: 'Саратов',
    59: 'Туймазы',
    60: 'Хайфа',
    61: 'Воронеж',
    62: 'Сочи',
    63: 'Севастополь',
    64: 'Альметьевск',
    65: 'Тамбов',
    67: 'Лимассол',
    68: 'Минск',
    69: 'Сургут',
    70: 'Ярославль',
    71: 'Сыктывкар',
    72: 'Октябрьский',
    73: 'Шахты',
    74: 'Липецк',
    75: 'Иерусалим',
    77: 'Петрозаводск',
    78: 'Омск',
    79: 'Томск',
    80: 'Караганда',
    81: 'Усть-Каменогорск',
};

/**
 * Reverse mapping: city name -> city code
 */
export const CITY_NAME_TO_CODE: Record<string, number> = Object.entries(CITY_CODES).reduce(
    (acc, [code, name]) => {
        acc[name.toLowerCase()] = Number(code);
        return acc;
    },
    {} as Record<string, number>
);

/**
 * Extract city code from URL or city name
 * Returns city code if found, null otherwise
 */
export function extractCityCodeFromUrl(url: string): number | null {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        // Try to match city slug from hostname (e.g., spb.quizplease.ru -> 11)
        const citySlugMatch = hostname.match(/^([^.]+)\.quizplease\.ru$/);
        if (citySlugMatch) {
            const citySlug = citySlugMatch[1];
            // Map city slugs to codes (based on cities.ts and CITY_CODES)
            const slugToCode: Record<string, number> = {
                'moscow': 4,
                'spb': 11,
                'novosibirsk': 5,
                'ekaterinburg': 7,
                'kazan': 15,
                'nizhniy': 9,
                'chelyabinsk': 6,
                'samara': 17,
                'omsk': 78,
                'rostov': 13,
                // Add more mappings as needed
                'ufa': 3,
                'cheboksary': 8,
                'tyumen': 18,
                'krasnodar': 31,
                'perm': 37,
                'voronezh': 61,
                'sochi': 62,
                'sevastopol': 63,
                'tambov': 65,
                'yakutsk': 82, // Example, adjust as needed
            };

            if (slugToCode[citySlug]) {
                return slugToCode[citySlug];
            }
        }

        return null;
    } catch {
        return null;
    }
}

