import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/**
 * Parses a date string in various formats:
 * - DD.MM.YYYY (e.g., 15.12.2024)
 * - DD.MM.YY (e.g., 15.12.24)
 * - DD.MM (assumes current year, e.g., 15.12)
 * 
 * Returns a Date object or null if parsing fails
 */
export function parseDate(dateStr: string): Date | null {
    const trimmed = dateStr.trim();
    
    // Try DD.MM.YYYY
    let parsed = dayjs(trimmed, 'DD.MM.YYYY', true);
    if (parsed.isValid()) {
        return parsed.toDate();
    }
    
    // Try DD.MM.YY
    parsed = dayjs(trimmed, 'DD.MM.YY', true);
    if (parsed.isValid()) {
        return parsed.toDate();
    }
    
    // Try DD.MM (assume current year)
    parsed = dayjs(trimmed, 'DD.MM', true);
    if (parsed.isValid()) {
        const currentYear = dayjs().year();
        parsed = parsed.year(currentYear);
        return parsed.toDate();
    }
    
    return null;
}

/**
 * Formats a date for display
 */
export function formatDateForDisplay(date: Date): string {
    return dayjs(date).format('DD.MM.YYYY');
}

/**
 * Formats a date and time for display (DD.MM HH:mm)
 */
export function formatDateTimeForDisplay(date: Date): string {
    return dayjs(date).format('DD.MM HH:mm');
}

/**
 * Validates that endDate is after startDate
 */
export function validateDateRange(startDate: Date, endDate: Date): boolean {
    return endDate > startDate;
}