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

// Graceful shutdown handler
function cleanupOnShutdown() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        cleanupStarted = false;
    }
}

process.once('SIGTERM', cleanupOnShutdown);
process.once('SIGINT', cleanupOnShutdown);

/**
 * Sets conversation state for a chat
 * State will automatically expire after TTL (30 minutes)
 * @param chatId - The chat ID to set state for
 * @param step - The current step in the conversation
 * @param data - Optional data to store with the state
 */
export function setConversationState(chatId: string, step: string, data: Record<string, any> = {}) {
    states.set(chatId, { 
        state: { step, data },
        expires: Date.now() + TTL_MS
    });
}

/**
 * Gets the current conversation state for a chat
 * Returns undefined if state doesn't exist or has expired
 * @param chatId - The chat ID to get state for
 * @returns The conversation state or undefined
 */
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

/**
 * Clears conversation state for a chat
 * @param chatId - The chat ID to clear state for
 */
export function clearConversationState(chatId: string) {
    states.delete(chatId);
}


