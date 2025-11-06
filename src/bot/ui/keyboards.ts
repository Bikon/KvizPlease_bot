import { InlineKeyboard } from 'grammy';
import { CB } from '../constants.js';
import { createButtonId } from './buttonMapping.js';

export function moreKeyboard(nextOffset: number, limit: number) {
    const kb = new InlineKeyboard();
    kb.text('Показать ещё', `more:upcoming:${nextOffset}:${limit}`);
    return kb;
}

export function buildTypesKeyboard(allTypes: string[], excludedTypes: Set<string>) {
    const kb = new InlineKeyboard();
    for (const t of allTypes) {
        const isExcluded = excludedTypes.has(t);
        // Limit type name length to avoid callback data overflow
        const displayName = t.length > 30 ? t.substring(0, 27) + '...' : t;
        const buttonId = createButtonId(t);
        kb.text(isExcluded ? `♻️ ${displayName}` : `🚫 ${displayName}`, (isExcluded ? CB.TYPE_UNEXCLUDE : CB.TYPE_EXCLUDE) + buttonId).row();
    }
    return kb;
}

export function buildPlayedKeyboard(groups: Array<{ group_key: string; type_name: string; num: string; played: boolean; polled?: boolean }>) {
    const kb = new InlineKeyboard();
    for (const g of groups) {
        const displayName = g.type_name.length > 25 ? g.type_name.substring(0, 22) + '...' : g.type_name;
        const label = g.played ? `✅ ${displayName} #${g.num}` : `◻️ ${displayName} #${g.num}`;
        const buttonId = createButtonId(g.group_key);
        const cb = (g.played ? CB.PLAYED_UNMARK : CB.PLAYED_MARK) + buttonId;
        kb.text(label, cb).row();
    }
    return kb;
}

