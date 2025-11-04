import 'dotenv/config';

export const config = {
  token: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
  cron: process.env.SCHEDULE_CRON || '0 10 * * MON',
  tz: process.env.SCHEDULE_TZ || 'Europe/Moscow',
  sourceUrl: process.env.SOURCE_URL!,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'quiz',
    password: process.env.DB_PASSWORD || 'quiz',
    database: process.env.DB_NAME || 'quiz',
  },
  filters: {
    districts: (process.env.DEFAULT_DISTRICTS || '').split(',').map(s => s.trim()).filter(Boolean),
    daysAhead: Number(process.env.DEFAULT_DAYS_AHEAD || 30),
    maxPollOptions: Math.min(Number(process.env.MAX_POLL_OPTIONS || 10), 10)
  }
} as const;

if (!config.token || !config.chatId || !config.sourceUrl) {
  throw new Error('⚠️ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SOURCE_URL обязательны');
}
