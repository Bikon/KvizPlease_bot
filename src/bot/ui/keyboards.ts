import { InlineKeyboard } from 'grammy';

import { CITIES } from '../cities.js';
import { CB } from '../constants.js';
import { createButtonId } from './buttonMapping.js';
import { formatGameDateTime } from '../../utils/dateFormatter.js';

export function moreKeyboard(mode: string, nextOffset: number, limit: number) {
    const kb = new InlineKeyboard();
    kb.text('Показать ещё', `more:upcoming:${mode}:${nextOffset}:${limit}`);
    return kb;
}

export function buildUpcomingModeKeyboard(limit: number) {
    const kb = new InlineKeyboard();
    kb.text('📦 По пакетам', `upcoming:packages:0:${limit}`).row();
    kb.text('📅 По дате', `upcoming:dates:0:${limit}`).row();
    kb.text('📝 Зарегистрированы', `upcoming:registered:0:${limit}`);
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

export function buildCitySelectionKeyboard() {
    const kb = new InlineKeyboard();
    const cities = Object.entries(CITIES);
    
    // Показываем по 2 города в ряд
    for (let i = 0; i < cities.length; i += 2) {
        const [key1, city1] = cities[i];
        kb.text(city1.name, CB.CITY_SELECT + key1);
        
        if (i + 1 < cities.length) {
            const [key2, city2] = cities[i + 1];
            kb.text(city2.name, CB.CITY_SELECT + key2);
        }
        kb.row();
    }
    
    return kb;
}

export function buildPollsByDateKeyboard(filtered = false) {
    const kb = new InlineKeyboard();
    const prefix = filtered ? CB.POLLS_BY_DATE_FILTERED : CB.POLLS_BY_DATE;
    kb.text('📅 Неделя', prefix + 'week').row();
    kb.text('📅 2 недели', prefix + '2weeks').row();
    kb.text('📅 Месяц', prefix + 'month').row();
    kb.text('📆 Свой период', prefix + 'custom');
    return kb;
}

export function buildPollsMainMenuKeyboard() {
    const kb = new InlineKeyboard();
    kb.text('🎯 По типам игр', CB.POLLS_MENU_BY_TYPES).row();
    kb.text('📅 По датам', CB.POLLS_MENU_BY_DATE).row();
    kb.text('📦 По номеру пакета', CB.POLLS_MENU_BY_PACKAGE).row();
    kb.text('🌐 Для всех пакетов', CB.POLLS_MENU_ALL);
    return kb;
}

export function buildPollsByTypesKeyboard(allTypes: string[], selectedTypes: Set<string>) {
    const kb = new InlineKeyboard();
    for (const t of allTypes) {
        const isSelected = selectedTypes.has(t);
        const displayName = t.length > 30 ? t.substring(0, 27) + '...' : t;
        const buttonId = createButtonId(t);
        const emoji = isSelected ? '✅' : '◻️';
        kb.text(`${emoji} ${displayName}`, CB.POLLS_BY_TYPE_TOGGLE + buttonId).row();
    }
    // Add "Create Polls" button at the bottom if types are selected
    if (selectedTypes.size > 0) {
        kb.text(`🗳 Создать опросы (${selectedTypes.size})`, CB.POLLS_BY_TYPE_CREATE);
    }
    return kb;
}

export function buildPollsByPackageKeyboard(packages: Array<{ index: number; name: string; num: string; count: number }>) {
    const kb = new InlineKeyboard();
    for (const pkg of packages) {
        const displayName = pkg.name.length > 25 ? pkg.name.substring(0, 22) + '...' : pkg.name;
        const label = `${displayName} #${pkg.num} (${pkg.count})`;
        kb.text(label, CB.POLLS_BY_PACKAGE + pkg.index).row();
    }
    return kb;
}

export function buildRestoreTypesKeyboard(excludedTypes: string[]) {
    const kb = new InlineKeyboard();
    for (const t of excludedTypes) {
        const displayName = t.length > 30 ? t.substring(0, 27) + '...' : t;
        const buttonId = createButtonId(t);
        kb.text(`♻️ ${displayName}`, CB.TYPE_RESTORE + buttonId).row();
    }
    return kb;
}

export function buildGameTypesMenuKeyboard() {
    const kb = new InlineKeyboard();
    kb.text('📦 Показать пакеты', CB.TYPES_MENU_SHOW_PACKS).row();
    kb.text('🚫 Исключить типы пакетов (игр)', CB.TYPES_MENU_EXCLUDE).row();
    kb.text('♻️ Восстановить типы пакетов (игр)', CB.TYPES_MENU_RESTORE).row();
    kb.text('📋 Список исключённых пакетов', CB.TYPES_MENU_SHOW_LIST);
    return kb;
}

export function buildPollsByTypesDateFilterKeyboard(typesCount: number) {
    const kb = new InlineKeyboard();
    kb.text('📅 С фильтром по дате', CB.POLLS_BY_TYPE_WITH_DATE).row();
    kb.text(`🌐 Без фильтра (все игры типов: ${typesCount})`, CB.POLLS_BY_TYPE_NO_DATE);
    return kb;
}

export function buildPollSelectionKeyboard(polls: Array<{ poll_id: string; label: string; vote_count: number }>, selected: Set<string>) {
    const kb = new InlineKeyboard();
    for (const poll of polls) {
        const emoji = selected.has(poll.poll_id) ? '✅' : '◻️';
        const buttonId = createButtonId(poll.poll_id);
        const buttonLabel = `${emoji} ${poll.label} (${poll.vote_count} 👤)`;
        kb.text(buttonLabel, CB.REG_POLL_TOGGLE + buttonId).row();
    }
    if (selected.size > 0) {
        kb.text(`✔️ Подтвердить выбор (${selected.size})`, CB.REG_POLL_CONFIRM);
    }
    return kb;
}

export function buildGameSelectionKeyboard(games: Array<{ external_id: string; title: string; date: string; venue: string; vote_count: number }>, selected: Set<string>) {
    const kb = new InlineKeyboard();
    for (const game of games) {
        const emoji = selected.has(game.external_id) ? '✅' : '◻️';
        const buttonId = createButtonId(game.external_id);
        const label = `${emoji} ${game.title} ${game.date} (${game.vote_count} 👤)`;
        kb.text(label, CB.REG_GAME_TOGGLE + buttonId).row();
    }
    if (selected.size > 0) {
        kb.text(`🎮 Зарегистрировать (${selected.size})`, CB.REG_GAME_CONFIRM);
    }
    return kb;
}

export function buildRegisteredGamesKeyboard(games: Array<{ external_id: string; title: string; registered: boolean; date_time: Date; group_key: string | null }>) {
    const kb = new InlineKeyboard();
    for (const game of games) {
        const emoji = game.registered ? '📝' : '◻️';
        const displayName = game.title.length > 30 ? game.title.substring(0, 27) + '...' : game.title;
        const buttonId = createButtonId(game.external_id);
        const callback = game.registered ? CB.REGISTERED_UNMARK : CB.REGISTERED_MARK;
        const { dd, mm, yyyy, hh, mi } = formatGameDateTime(game.date_time);
        kb.text(`${emoji} ${displayName} • ${dd}.${mm}.${yyyy} ${hh}:${mi}`, callback + buttonId).row();
    }
    return kb;
}

export function buildManageStatusMenuKeyboard() {
    const kb = new InlineKeyboard();
    kb.text('🎮 Пометить «сыграно»', CB.STATUS_MENU_PLAYED).row();
    kb.text('📝 Управлять регистрациями', CB.STATUS_MENU_REGISTERED);
    return kb;
}