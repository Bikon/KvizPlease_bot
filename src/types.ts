export type RawGame = {
    externalId: string;
    title: string;           // исходный заголовок: "Квиз, плиз! #1212" или "[music party] рашн эдишн #7"
    gameType?: string;       // часть до # (как есть)
    gameNumber?: string;     // "1212"
    date: string;            // "4 ноября" и т.п.
    time?: string;           // "в 16:00"
    venue?: string;
    district?: string;
    address?: string;
    price?: string;
    difficulty?: string;
    status?: string;
    url: string;
};

export type Game = {
    externalId: string;
    title: string;
    dateTime: Date;
    venue?: string;
    district?: string;
    address?: string;
    price?: string;
    difficulty?: string;
    status?: string;
    url: string;
    groupKey: string; // "<name>#<number>" нормализованный
    name: string;     // нормализованное имя (для группировки)
    number: string;   // номер выпуска
};

export type Group = {
    groupKey: string;
    name: string;
    number: string;
    items: Game[];
};
