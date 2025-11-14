/**
 * Logger utility with support for different log levels
 * Supports: debug, info, warn, error
 * Log level can be controlled via LOG_LEVEL environment variable
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const currentLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatMessage(level: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')}`;
}

export const log = {
    /**
     * Log debug messages (only shown if LOG_LEVEL=debug)
     */
    debug: (...args: unknown[]) => {
        if (shouldLog('debug')) {
            console.log(formatMessage('DEBUG', ...args));
        }
    },
    
    /**
     * Log informational messages
     */
    info: (...args: unknown[]) => {
        if (shouldLog('info')) {
            console.log(formatMessage('INFO', ...args));
        }
    },
    
    /**
     * Log warning messages
     */
    warn: (...args: unknown[]) => {
        if (shouldLog('warn')) {
            console.warn(formatMessage('WARN', ...args));
        }
    },
    
    /**
     * Log error messages
     */
    error: (...args: unknown[]) => {
        if (shouldLog('error')) {
            console.error(formatMessage('ERROR', ...args));
        }
    },
};
