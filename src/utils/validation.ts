/**
 * Input validation utilities
 */

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validates and normalizes a Telegram chat ID
 * @param chatId - The chat ID to validate (can be string or number)
 * @returns Normalized chat ID as string
 * @throws {ValidationError} If chat ID is invalid
 * @example
 * ```ts
 * const id = validateChatId('123456789');
 * // Returns: '123456789'
 * ```
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
 * Sanitizes text input to prevent XSS and other security issues
 * @param input - The input string to sanitize
 * @param maxLength - Maximum length of the output (default: 255)
 * @returns Sanitized string with HTML tags removed and trimmed
 * @example
 * ```ts
 * const safe = sanitizeInput('<script>alert("xss")</script>Hello', 100);
 * // Returns: 'scriptalert("xss")/scriptHello'
 * ```
 */
export function sanitizeInput(input: string, maxLength: number = 255): string {
    return input
        .trim()
        .slice(0, maxLength)
        .replace(/[<>]/g, ''); // Basic XSS prevention
}

/**
 * Validates URL format and ensures it uses HTTP/HTTPS protocol
 * @param url - The URL string to validate
 * @returns Parsed URL object
 * @throws {ValidationError} If URL is invalid or doesn't use HTTP/HTTPS
 * @example
 * ```ts
 * const url = validateUrl('https://example.com');
 * // Returns: URL object
 * ```
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
        // If it's already a ValidationError, re-throw it
        if (error instanceof ValidationError) {
            throw error;
        }
        // Otherwise, wrap the error
        throw new ValidationError('Invalid URL format');
    }
}

/**
 * Validates that URL is from quizplease.ru domain and points to a schedule page
 * @param url - The URL string to validate
 * @returns Parsed URL object
 * @throws {ValidationError} If URL is not from quizplease.ru or not a schedule page
 * @example
 * ```ts
 * const url = validateQuizPleaseUrl('https://moscow.quizplease.ru/schedule');
 * // Returns: URL object
 * ```
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
 * Validates and sanitizes team name
 * @param name - The team name to validate
 * @returns Sanitized team name (2-100 characters)
 * @throws {ValidationError} If team name is too short or too long
 * @example
 * ```ts
 * const name = validateTeamName('My Team');
 * // Returns: 'My Team'
 * ```
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
 * Validates and sanitizes captain name
 * @param name - The captain name to validate
 * @returns Sanitized captain name (2-100 characters)
 * @throws {ValidationError} If captain name is too short or too long
 * @example
 * ```ts
 * const name = validateCaptainName('John Doe');
 * // Returns: 'John Doe'
 * ```
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
 * Validates and normalizes email address
 * @param email - The email address to validate
 * @returns Normalized email (lowercase, sanitized)
 * @throws {ValidationError} If email format is invalid
 * @example
 * ```ts
 * const email = validateEmail('User@Example.COM');
 * // Returns: 'user@example.com'
 * ```
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
 * Validates and normalizes Russian phone number
 * Accepts formats: +79991234567, 89991234567, 79991234567
 * @param phone - The phone number to validate
 * @returns Normalized phone number in +7XXXXXXXXXX format
 * @throws {ValidationError} If phone number format is invalid
 * @example
 * ```ts
 * const phone = validatePhone('8-999-123-45-67');
 * // Returns: '+79991234567'
 * ```
 */
export function validatePhone(phone: string): string {
    const sanitized = sanitizeInput(phone, 20);
    // Remove all non-digit characters except +
    const digits = sanitized.replace(/[^\d+]/g, '');
    
    // Check if it's a valid Russian phone number
    // Formats: +79991234567 (12 chars: +7 + 10 digits), 89991234567 (11 digits: 8 + 10), 79991234567 (11 digits: 7 + 10)
    // Must start with +7, 8, or 7, followed by exactly 10 digits
    const phoneRegex = /^(\+7|8|7)\d{10}$/;
    if (!phoneRegex.test(digits)) {
        throw new ValidationError('Invalid phone number format. Use Russian format: +79991234567 or 89991234567');
    }
    
    // Normalize to +7 format
    if (digits.startsWith('+7')) {
        return digits; // Already in correct format
    } else if (digits.startsWith('8')) {
        // Replace leading 8 with +7
        return '+7' + digits.slice(1);
    } else if (digits.startsWith('7')) {
        // Replace leading 7 with +7
        return '+7' + digits.slice(1);
    }
    // Should never reach here due to regex check, but just in case
    return '+7' + digits;
}

/**
 * Validates limit parameter for pagination
 * @param limit - The limit value to validate (can be string, number, or undefined)
 * @param defaultLimit - Default value if limit is invalid (default: 15)
 * @param maxLimit - Maximum allowed value (default: 50)
 * @returns Validated limit number between 1 and maxLimit
 * @example
 * ```ts
 * const limit = validateLimit('20', 15, 50);
 * // Returns: 20
 * const limit2 = validateLimit('100', 15, 50);
 * // Returns: 50 (capped at maxLimit)
 * ```
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

