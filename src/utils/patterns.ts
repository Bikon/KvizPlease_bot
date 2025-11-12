/**
 * Common regex patterns used across the application
 */

// Extract game number from text (e.g., "#123" -> "123")
export const GAME_NUMBER_PATTERN = /#(\d+)/;

// Match content in square brackets (e.g., "[караоке]")
export const BRACKET_CONTENT_PATTERN = /\[.+?\].*/;

// Match time format "в HH:MM" (case insensitive)
export const TIME_FORMAT_PATTERN = /^в\s*\d{1,2}:\d{2}$/i;

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

