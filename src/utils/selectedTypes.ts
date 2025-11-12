// Store selected types per chat for polls_by_types command
const selectedTypesMap = new Map<string, Set<string>>();

export function toggleSelectedType(chatId: string, typeName: string): void {
    if (!selectedTypesMap.has(chatId)) {
        selectedTypesMap.set(chatId, new Set());
    }
    const selected = selectedTypesMap.get(chatId)!;
    if (selected.has(typeName)) {
        selected.delete(typeName);
    } else {
        selected.add(typeName);
    }
}

export function getSelectedTypes(chatId: string): Set<string> {
    return selectedTypesMap.get(chatId) || new Set();
}

export function clearSelectedTypes(chatId: string): void {
    selectedTypesMap.delete(chatId);
}

