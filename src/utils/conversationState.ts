/**
 * Simple conversation state manager for multi-step conversations
 * Includes TTL to prevent memory leaks
 */

interface ConversationState {
    step: string;
    data: Record<string, any>;
}

interface StateEntry {
    state: ConversationState;
    expires: number;
}

const states = new Map<string, StateEntry>();

// TTL: 30 minutes
const TTL_MS = 30 * 60 * 1000;

// Cleanup interval: every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Start cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupStarted = false;

function startCleanupInterval() {
    if (cleanupInterval || cleanupStarted) return;
    cleanupStarted = true;
    
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        let cleaned = 0;
        for (const [chatId, entry] of states.entries()) {
            if (entry.expires < now) {
                states.delete(chatId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            // Log only if we actually cleaned something
            // This prevents log spam
        }
    }, CLEANUP_INTERVAL_MS);
}

// Start cleanup on module load
startCleanupInterval();

// Graceful shutdown
process.once('SIGTERM', () => {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        cleanupStarted = false;
    }
});

process.once('SIGINT', () => {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        cleanupStarted = false;
    }
});

export function setConversationState(chatId: string, step: string, data: Record<string, any> = {}) {
    states.set(chatId, { 
        state: { step, data },
        expires: Date.now() + TTL_MS
    });
}

export function getConversationState(chatId: string): ConversationState | undefined {
    const entry = states.get(chatId);
    if (!entry) return undefined;
    
    // Check if expired
    if (entry.expires < Date.now()) {
        states.delete(chatId);
        return undefined;
    }
    
    return entry.state;
}

export function clearConversationState(chatId: string) {
    states.delete(chatId);
}

export function updateConversationData(chatId: string, newData: Record<string, any>) {
    const entry = states.get(chatId);
    if (entry) {
        entry.state.data = { ...entry.state.data, ...newData };
        entry.expires = Date.now() + TTL_MS; // Reset TTL on update
        states.set(chatId, entry);
    }
}

