import { CITY_CODES, CITY_NAME_TO_CODE } from '../utils/cityCodes.js';

export const CITIES = {
    'moscow': { name: 'Москва', url: 'https://moscow.quizplease.ru/schedule', code: 4 },
    'spb': { name: 'Санкт-Петербург', url: 'https://spb.quizplease.ru/schedule', code: 11 },
    'novosibirsk': { name: 'Новосибирск', url: 'https://novosibirsk.quizplease.ru/schedule', code: 5 },
    'ekaterinburg': { name: 'Екатеринбург', url: 'https://ekaterinburg.quizplease.ru/schedule', code: 7 },
    'kazan': { name: 'Казань', url: 'https://kazan.quizplease.ru/schedule', code: 15 },
    'nizhniy': { name: 'Нижний Новгород', url: 'https://nizhniy.quizplease.ru/schedule', code: 9 },
    'chelyabinsk': { name: 'Челябинск', url: 'https://chelyabinsk.quizplease.ru/schedule', code: 6 },
    'samara': { name: 'Самара', url: 'https://samara.quizplease.ru/schedule', code: 17 },
    'omsk': { name: 'Омск', url: 'https://omsk.quizplease.ru/schedule', code: 78 },
    'rostov': { name: 'Ростов-на-Дону', url: 'https://rostov.quizplease.ru/schedule', code: 13 },
} as const;

export type CityKey = keyof typeof CITIES;

// Export city codes for use in API calls
export { CITY_CODES, CITY_NAME_TO_CODE };