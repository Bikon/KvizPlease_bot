import { Pool } from 'pg';

import { config } from '../config.js';
import { log } from '../utils/logger.js';

export const pool = new Pool({
    ...config.db,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
});

// Handle pool errors
pool.on('error', (err) => {
    log.error('Unexpected database pool error:', err);
});

// Log pool events in development
if (process.env.NODE_ENV === 'development') {
    pool.on('connect', () => {
        log.info('New database client connected');
    });
    
    pool.on('remove', () => {
        log.info('Database client removed from pool');
    });
}
