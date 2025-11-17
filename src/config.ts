import 'dotenv/config';

export const config = {
    token: process.env.TELEGRAM_BOT_TOKEN!,
    chatId: process.env.TELEGRAM_CHAT_ID!,
    cron: process.env.SCHEDULE_CRON || '0 10 * * MON',
    tz: process.env.SCHEDULE_TZ || 'Europe/Moscow',
    sourceUrl: process.env.SOURCE_URL || '',
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'quiz',
    },
    filters: {
        maxPollOptions: Math.min(Number(process.env.MAX_POLL_OPTIONS || 10), 10),
    }
} as const;

if (!config.token || !config.chatId) {
    throw new Error('⚠️ TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID обязательны');
}
