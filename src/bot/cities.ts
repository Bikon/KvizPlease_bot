export const CITIES = {
    'moscow': { name: 'Москва', url: 'https://moscow.quizplease.ru/schedule' },
    'spb': { name: 'Санкт-Петербург', url: 'https://spb.quizplease.ru/schedule' },
    'novosibirsk': { name: 'Новосибирск', url: 'https://novosibirsk.quizplease.ru/schedule' },
    'ekaterinburg': { name: 'Екатеринбург', url: 'https://ekaterinburg.quizplease.ru/schedule' },
    'kazan': { name: 'Казань', url: 'https://kazan.quizplease.ru/schedule' },
    'nizhniy': { name: 'Нижний Новгород', url: 'https://nizhniy.quizplease.ru/schedule' },
    'chelyabinsk': { name: 'Челябинск', url: 'https://chelyabinsk.quizplease.ru/schedule' },
    'samara': { name: 'Самара', url: 'https://samara.quizplease.ru/schedule' },
    'omsk': { name: 'Омск', url: 'https://omsk.quizplease.ru/schedule' },
    'rostov': { name: 'Ростов-на-Дону', url: 'https://rostov.quizplease.ru/schedule' },
} as const;

export type CityKey = keyof typeof CITIES;




