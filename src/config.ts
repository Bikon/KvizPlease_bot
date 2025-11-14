import 'dotenv/config';
import { z } from 'zod';

// Configuration schema with validation
const configSchema = z.object({
    token: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    chatId: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),
    cron: z.string().default('0 10 * * MON'),
    tz: z.string().default('Europe/Moscow'),
    sourceUrl: z.string().default(''),
    db: z.object({
        host: z.string().default('localhost'),
        port: z.number().int().positive().default(5432),
        user: z.string().default('postgres'),
        password: z.string().default('postgres'),
        database: z.string().default('quiz'),
    }),
    filters: z.object({
        districts: z.array(z.string()).default([]),
        daysAhead: z.number().int().positive().default(30),
        maxPollOptions: z.number().int().min(1).max(10).default(10),
    }),
    limits: z.object({
        telegramMessageMaxLength: z.number().int().positive().default(4096),
        telegramMessageSafeLength: z.number().int().positive().default(3800),
        pollChunkSize: z.number().int().positive().default(9),
        maxUpcomingLimit: z.number().int().positive().default(50),
        defaultUpcomingLimit: z.number().int().positive().default(15),
    }),
    delays: z.object({
        registrationBetweenGames: z.number().int().nonnegative().default(2000),
        scraperScroll: z.number().int().nonnegative().default(800),
    }),
    retries: z.object({
        browserAttempts: z.number().int().positive().default(3),
        httpAttempts: z.number().int().positive().default(2),
    }),
});

// Parse and validate configuration
const rawConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
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
        districts: (process.env.DEFAULT_DISTRICTS || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        daysAhead: Number(process.env.DEFAULT_DAYS_AHEAD || 30),
        maxPollOptions: Math.min(Number(process.env.MAX_POLL_OPTIONS || 10), 10),
    },
    limits: {
        telegramMessageMaxLength: 4096,
        telegramMessageSafeLength: 3800,
        pollChunkSize: 9,
        maxUpcomingLimit: 50,
        defaultUpcomingLimit: 15,
    },
    delays: {
        registrationBetweenGames: 2000,
        scraperScroll: 800,
    },
    retries: {
        browserAttempts: 3,
        httpAttempts: 2,
    },
};

let config: z.infer<typeof configSchema>;

try {
    config = configSchema.parse(rawConfig);
} catch (error) {
    if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
        throw new Error(`Configuration validation failed:\n${errors}`);
    }
    throw error;
}

export { config };
