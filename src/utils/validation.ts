/**
 * Input validation utilities
 */

export class ValidationError extends Error {
    constructor(message: string, public field?: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validates and normalizes chat ID
 */
export function validateChatId(chatId: unknown): string {
    if (typeof chatId !== 'string') {
        throw new ValidationError('Chat ID must be a string');
    }
    
    const trimmed = chatId.trim();
    if (trimmed === '') {
        throw new ValidationError('Chat ID cannot be empty');
    }
    
    // Telegram chat IDs are numeric strings (can be negative for groups)
    if (!/^-?\d+$/.test(trimmed)) {
        throw new ValidationError('Invalid chat ID format');
    }
    
    return trimmed;
}

/**
 * Sanitizes text input to prevent XSS and other issues
 */
export function sanitizeInput(input: string, maxLength: number = 255): string {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input
        .trim()
        .slice(0, maxLength)
        .replace(/[<>]/g, ''); // Basic XSS prevention
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): URL {
    try {
        const parsed = new URL(url);
        
        // Ensure it's HTTP/HTTPS
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new ValidationError('URL must use HTTP or HTTPS protocol');
        }
        
        return parsed;
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError('Invalid URL format');
    }
}

/**
 * Validates that URL is from quizplease.ru domain
 */
export function validateQuizPleaseUrl(url: string): URL {
    const parsed = validateUrl(url);
    
    if (!parsed.hostname.includes('quizplease.ru')) {
        throw new ValidationError('URL must be from quizplease.ru domain');
    }
    
    if (!parsed.pathname.includes('/schedule')) {
        throw new ValidationError('URL must point to a schedule page');
    }
    
    return parsed;
}

/**
 * Validates team name
 */
export function validateTeamName(name: string): string {
    const sanitized = sanitizeInput(name, 100);
    if (sanitized.length < 2) {
        throw new ValidationError('Team name must be at least 2 characters long');
    }
    if (sanitized.length > 100) {
        throw new ValidationError('Team name must be at most 100 characters long');
    }
    return sanitized;
}

/**
 * Validates captain name
 */
export function validateCaptainName(name: string): string {
    const sanitized = sanitizeInput(name, 100);
    if (sanitized.length < 2) {
        throw new ValidationError('Captain name must be at least 2 characters long');
    }
    if (sanitized.length > 100) {
        throw new ValidationError('Captain name must be at most 100 characters long');
    }
    return sanitized;
}

/**
 * Validates email format
 */
export function validateEmail(email: string): string {
    const sanitized = sanitizeInput(email, 255);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
        throw new ValidationError('Invalid email format');
    }
    return sanitized.toLowerCase();
}

/**
 * Validates phone number (Russian format)
 */
export function validatePhone(phone: string): string {
    const sanitized = sanitizeInput(phone, 20);
    // Remove all non-digit characters except +
    const digits = sanitized.replace(/[^\d+]/g, '');
    
    // Check if it's a valid Russian phone number
    // Formats: +79991234567, 89991234567, 9991234567
    const phoneRegex = /^(\+?7|8)?\d{10}$/;
    if (!phoneRegex.test(digits)) {
        throw new ValidationError('Invalid phone number format. Use Russian format: +79991234567 or 89991234567');
    }
    
    // Normalize to +7 format
    const normalized = digits.replace(/^(\+?7|8)/, '+7');
    return normalized;
}

/**
 * Validates limit parameter for pagination
 */
export function validateLimit(limit: unknown, defaultLimit: number = 15, maxLimit: number = 50): number {
    if (limit === undefined || limit === null || limit === '') {
        return defaultLimit;
    }
    
    const num = typeof limit === 'string' ? parseInt(limit.trim(), 10) : Number(limit);
    
    if (!Number.isFinite(num) || num <= 0) {
        return defaultLimit;
    }
    
    return Math.min(num, maxLimit);
}

