/**
 * Common regex patterns used across the application
 */

// Extract game number from text (e.g., "#123" -> "123")
export const GAME_NUMBER_PATTERN = /#(\d+)/;

// Match content in square brackets (e.g., "[караоке]")
export const BRACKET_CONTENT_PATTERN = /\[.+?].*/;

// Match time format "в HH:MM" (case insensitive)
export const TIME_FORMAT_PATTERN = /^в\s*\d{1,2}:\d{2}$/i;

// Email validation pattern
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone number pattern (Russian format with optional +7)
export const PHONE_PATTERN = /^(\+?7|8)?[\s-]?\(?(\d{3})\)?[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})$/;

/**
 * Extract game number from title or text
 */
export function extractGameNumber(text: string): string | undefined {
    return text.match(GAME_NUMBER_PATTERN)?.[1];
}

/**
 * Extract bracket content from text
 */
export function extractBracketContent(text: string): string | null {
    const match = text.match(BRACKET_CONTENT_PATTERN);
    return match ? match[0].trim() : null;
}

/**
 * Check if text matches time format
 */
export function isTimeFormat(text: string): boolean {
    return TIME_FORMAT_PATTERN.test(text);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
    return EMAIL_PATTERN.test(email);
}

/**
 * Validate and normalize phone number
 * Accepts formats: +79991234567, 89991234567, 9991234567, +7 999 123 45 67, etc.
 */
export function validateAndNormalizePhone(phone: string): string | null {
    const match = phone.trim().match(PHONE_PATTERN);
    if (!match) return null;
    
    // Normalize to +7XXXXXXXXXX format
    const digits = match.slice(2).join('');
    return `+7${digits}`;
}