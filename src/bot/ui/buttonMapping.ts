// Maps short button IDs to full group keys to stay within Telegram's 64-byte callback_data limit
const buttonMap = new Map<string, string>();
let idCounter = 0;

export function createButtonId(groupKey: string): string {
    // Check if we already have an ID for this group key
    for (const [id, key] of buttonMap.entries()) {
        if (key === groupKey) return id;
    }
    
    // Create new short ID
    const id = `g${idCounter++}`;
    buttonMap.set(id, groupKey);
    
    // Clean up old mappings (keep last 1000)
    if (buttonMap.size > 1000) {
        const firstKey = buttonMap.keys().next().value;
        if (firstKey) buttonMap.delete(firstKey);
    }
    
    return id;
}

export function resolveButtonId(id: string): string | undefined {
    return buttonMap.get(id);
}


