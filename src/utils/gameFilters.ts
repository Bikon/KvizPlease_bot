import type { DbGame } from '../types.js';

/**
 * Filter games by type names
 * Matches if game title starts with or contains the type name
 */
export function filterGamesByTypes(games: DbGame[], selectedTypes: Set<string>): DbGame[] {
    return games.filter(g => {
        const gameType = g.title.split('#')[0].trim();
        return selectedTypes.has(gameType) || Array.from(selectedTypes).some(t => g.title.includes(t));
    });
}

/**
 * Sort games by date chronologically
 */
export function sortGamesByDate(games: DbGame[]): DbGame[] {
    return [...games].sort((a, b) => 
        new Date(a.date_time).getTime() - new Date(b.date_time).getTime()
    );
}

/**
 * Get plural form of "опрос" based on count
 */
export function getPollWordForm(count: number): string {
    if (count === 1) return 'опрос';
    if (count >= 2 && count <= 4) return 'опроса';
    return 'опросов';
}

