/**
 * Custom error classes for better error handling
 */

export class BotError extends Error {
    constructor(
        message: string,
        public code: string,
        public chatId?: string,
        public originalError?: unknown
    ) {
        super(message);
        this.name = 'BotError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class DatabaseError extends BotError {
    constructor(message: string, chatId?: string, originalError?: unknown) {
        super(message, 'DATABASE_ERROR', chatId, originalError);
        this.name = 'DatabaseError';
    }
}

export class ScraperError extends BotError {
    constructor(message: string, chatId?: string, originalError?: unknown) {
        super(message, 'SCRAPER_ERROR', chatId, originalError);
        this.name = 'ScraperError';
    }
}

export class RegistrationError extends BotError {
    constructor(message: string, chatId?: string, originalError?: unknown) {
        super(message, 'REGISTRATION_ERROR', chatId, originalError);
        this.name = 'RegistrationError';
    }
}

