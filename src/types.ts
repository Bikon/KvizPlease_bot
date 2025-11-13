export type RawGame = {
    externalId: string;
    title: string;           // строка вида "Квиз, плиз! #1212" или "[music party] рашн эдишн #7"
    gameType?: string;       // "[music party] рашн эдишн" или "Квиз, плиз"
    gameNumber?: string;     // "7" или "1212"
    date: string;
    time?: string;
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
    groupKey?: string; // "[тип]#номер" или "Квиз, плиз#1212"
    played?: boolean;
    excluded?: boolean;
};

export type GameGroup = {
    groupKey: string;   // "[тип]#номер"
    name: string;       // "[тип]" или "Квиз, плиз"
    number: string;     // "7" / "1212"
    items: Game[];      // все даты (>=1)
    played?: boolean;   // если все помечены как played или есть запись о played по группе
    excluded?: boolean; // если группа исключена (таблица excluded_groups или все items.excluded)
};

// Database row types
export type DbGame = {
    id: number;
    chat_id: string;
    external_id: string;
    title: string;
    date_time: Date;
    venue: string | null;
    district: string | null;
    address: string | null;
    price: string | null;
    difficulty: string | null;
    status: string | null;
    url: string;
    group_key: string | null;
    source_url: string;
    created_at: Date;
    updated_at: Date;
    last_seen_at: Date;
    excluded: boolean;
    played: boolean;
    registered: boolean;
    registered_at: Date | null;
};

export type DbGameGroup = {
    group_key: string;
    type_name: string;
    num: string;
    played: boolean;
    cnt: number;
    polled_by_package: boolean;
    polled_by_date: boolean;
};

export type PollGroup = {
    groupKey: string;
    name: string;
    number: string;
    items: DbGame[];
};