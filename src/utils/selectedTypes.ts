// Store selected types per chat for polls_by_types command
// Includes TTL to prevent memory leaks
interface TypeSelectionEntry {
    selected: Set<string>;
    expires: number;
}

const selectedTypesMap = new Map<string, TypeSelectionEntry>();

// TTL: 1 hour (longer than conversation state since this is used in multi-step flows)
const TTL_MS = 60 * 60 * 1000;

// Cleanup interval: every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanupInterval() {
    if (cleanupInterval) return;
    
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [chatId, entry] of selectedTypesMap.entries()) {
            if (entry.expires < now) {
                selectedTypesMap.delete(chatId);
            }
        }
    }, CLEANUP_INTERVAL_MS);
}

startCleanupInterval();

export function toggleSelectedType(chatId: string, typeName: string): void {
    let entry = selectedTypesMap.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        entry = {
            selected: new Set(),
            expires: Date.now() + TTL_MS
        };
        selectedTypesMap.set(chatId, entry);
    }
    
    if (entry.selected.has(typeName)) {
        entry.selected.delete(typeName);
    } else {
        entry.selected.add(typeName);
    }
    entry.expires = Date.now() + TTL_MS; // Reset TTL on update
}

export function getSelectedTypes(chatId: string): Set<string> {
    const entry = selectedTypesMap.get(chatId);
    if (!entry || entry.expires < Date.now()) {
        if (entry) selectedTypesMap.delete(chatId);
        return new Set();
    }
    return entry.selected;
}

export function clearSelectedTypes(chatId: string): void {
    selectedTypesMap.delete(chatId);
}