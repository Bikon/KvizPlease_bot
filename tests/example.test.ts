/**
 * Example test file structure
 * 
 * To run tests, install a test framework:
 * npm install --save-dev vitest @vitest/ui
 * 
 * Then add to package.json:
 * "scripts": {
 *   "test": "vitest",
 *   "test:ui": "vitest --ui"
 * }
 */

import { describe, it, expect } from 'vitest';
import { validateChatId, validateEmail, validatePhone, ValidationError } from '../src/utils/validation.js';

describe('Validation Utilities', () => {
    describe('validateChatId', () => {
        it('should validate correct chat ID', () => {
            expect(validateChatId('123456789')).toBe('123456789');
            expect(validateChatId('-1001234567890')).toBe('-1001234567890');
        });

        it('should throw ValidationError for invalid chat ID', () => {
            expect(() => validateChatId('')).toThrow(ValidationError);
            expect(() => validateChatId('abc')).toThrow(ValidationError);
            expect(() => validateChatId(null)).toThrow(ValidationError);
        });
    });

    describe('validateEmail', () => {
        it('should validate correct email', () => {
            expect(validateEmail('test@example.com')).toBe('test@example.com');
            expect(validateEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
        });

        it('should throw ValidationError for invalid email', () => {
            expect(() => validateEmail('invalid')).toThrow(ValidationError);
            expect(() => validateEmail('@example.com')).toThrow(ValidationError);
        });
    });

    describe('validatePhone', () => {
        it('should validate and normalize Russian phone numbers', () => {
            expect(validatePhone('+79991234567')).toBe('+79991234567');
            expect(validatePhone('89991234567')).toBe('+79991234567');
            expect(validatePhone('79991234567')).toBe('+79991234567');
        });

        it('should throw ValidationError for invalid phone', () => {
            expect(() => validatePhone('1234567890')).toThrow(ValidationError);
            expect(() => validatePhone('+1234567890')).toThrow(ValidationError);
        });
    });
});

