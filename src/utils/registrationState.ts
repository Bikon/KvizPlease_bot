// Store selected polls and games for registration flow
// Includes TTL to prevent memory leaks
interface RegistrationStateEntry {
    selected: Set<string>;
    expires: number;
}

interface PollGameMappingEntry {
    mapping: Map<string, number>;
    expires: number;
}

const selectedPollsMap = new Map<string, RegistrationStateEntry>();
const selectedGamesMap = new Map<string, RegistrationStateEntry>();
const pollGameMappingMap = new Map<string, PollGameMappingEntry>(); // chatId -> (gameExternalId -> voteCount)

// TTL: 1 hour (registration flow can take time)
const TTL_MS = 60 * 60 * 1000;

// Cleanup interval: every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let cleanupInterval: NodeJS.Timeout | null = null;
let cleanupStarted = false;

function startCleanupInterval() {
    if (cleanupInterval || cleanupStarted) return;
    cleanupStarted = true;
    
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [chatId, entry] of selectedPollsMap.entries()) {
            if (entry.expires < now) {
                selectedPollsMap.delete(chatId);
            }
        }
        for (const [chatId, entry] of selectedGamesMap.entries()) {
            if (entry.expires < now) {
                selectedGamesMap.delete(chatId);
            }
        }
        for (const [chatId, entry] of pollGameMappingMap.entries()) {
            if (entry.expires < now) {
                pollGameMappingMap.delete(chatId);
            }
        }
    }, CLEANUP_INTERVAL_MS);
}

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

function getOrCreateEntry(map: Map<string, RegistrationStateEntry>, chatId: string): RegistrationStateEntry {
    let entry = map.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        entry = {
            selected: new Set(),
            expires: Date.now() + TTL_MS
        };
        map.set(chatId, entry);
    }
    return entry;
}

export function toggleSelectedPoll(chatId: string, pollId: string): void {
    const entry = getOrCreateEntry(selectedPollsMap, chatId);
    if (entry.selected.has(pollId)) {
        entry.selected.delete(pollId);
    } else {
        entry.selected.add(pollId);
    }
    entry.expires = Date.now() + TTL_MS; // Reset TTL on update
}

export function getSelectedPolls(chatId: string): Set<string> {
    const entry = selectedPollsMap.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        if (entry) selectedPollsMap.delete(chatId);
        return new Set();
    }
    return entry.selected;
}

export function clearSelectedPolls(chatId: string): void {
    selectedPollsMap.delete(chatId);
}

export function toggleSelectedGame(chatId: string, gameExternalId: string): void {
    const entry = getOrCreateEntry(selectedGamesMap, chatId);
    if (entry.selected.has(gameExternalId)) {
        entry.selected.delete(gameExternalId);
    } else {
        entry.selected.add(gameExternalId);
    }
    entry.expires = Date.now() + TTL_MS; // Reset TTL on update
}

export function getSelectedGames(chatId: string): Set<string> {
    const entry = selectedGamesMap.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        if (entry) selectedGamesMap.delete(chatId);
        return new Set();
    }
    return entry.selected;
}

export function clearSelectedGames(chatId: string): void {
    selectedGamesMap.delete(chatId);
}

// Store game vote counts during registration flow
export function setPollGameMapping(chatId: string, mapping: Map<string, number>): void {
    pollGameMappingMap.set(chatId, {
        mapping,
        expires: Date.now() + TTL_MS
    });
}

export function getPollGameMapping(chatId: string): Map<string, number> {
    const entry = pollGameMappingMap.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        if (entry) pollGameMappingMap.delete(chatId);
        return new Map();
    }
    return entry.mapping;
}

export function clearPollGameMapping(chatId: string): void {
    pollGameMappingMap.delete(chatId);
}

export function clearAllRegistrationState(chatId: string): void {
    clearSelectedPolls(chatId);
    clearSelectedGames(chatId);
    clearPollGameMapping(chatId);
}
