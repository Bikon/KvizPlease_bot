// Store selected polls and games for registration flow
const selectedPollsMap = new Map<string, Set<string>>();
const selectedGamesMap = new Map<string, Set<string>>();
const pollGameMappingMap = new Map<string, Map<string, number>>(); // chatId -> (gameExternalId -> voteCount)

export function toggleSelectedPoll(chatId: string, pollId: string): void {
    if (!selectedPollsMap.has(chatId)) {
        selectedPollsMap.set(chatId, new Set());
    }
    const selected = selectedPollsMap.get(chatId)!;
    if (selected.has(pollId)) {
        selected.delete(pollId);
    } else {
        selected.add(pollId);
    }
}

export function getSelectedPolls(chatId: string): Set<string> {
    return selectedPollsMap.get(chatId) || new Set();
}

export function clearSelectedPolls(chatId: string): void {
    selectedPollsMap.delete(chatId);
}

export function toggleSelectedGame(chatId: string, gameExternalId: string): void {
    if (!selectedGamesMap.has(chatId)) {
        selectedGamesMap.set(chatId, new Set());
    }
    const selected = selectedGamesMap.get(chatId)!;
    if (selected.has(gameExternalId)) {
        selected.delete(gameExternalId);
    } else {
        selected.add(gameExternalId);
    }
}

export function getSelectedGames(chatId: string): Set<string> {
    return selectedGamesMap.get(chatId) || new Set();
}

export function clearSelectedGames(chatId: string): void {
    selectedGamesMap.delete(chatId);
}

// Store game vote counts during registration flow
export function setPollGameMapping(chatId: string, mapping: Map<string, number>): void {
    pollGameMappingMap.set(chatId, mapping);
}

export function getPollGameMapping(chatId: string): Map<string, number> {
    return pollGameMappingMap.get(chatId) || new Map();
}

export function clearPollGameMapping(chatId: string): void {
    pollGameMappingMap.delete(chatId);
}

export function clearAllRegistrationState(chatId: string): void {
    clearSelectedPolls(chatId);
    clearSelectedGames(chatId);
    clearPollGameMapping(chatId);
}

