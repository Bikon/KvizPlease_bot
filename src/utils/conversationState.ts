/**
 * Simple conversation state manager for multi-step conversations
 */

interface ConversationState {
    step: string;
    data: Record<string, any>;
}

const states = new Map<string, ConversationState>();

export function setConversationState(chatId: string, step: string, data: Record<string, any> = {}) {
    states.set(chatId, { step, data });
}

export function getConversationState(chatId: string): ConversationState | undefined {
    return states.get(chatId);
}

export function clearConversationState(chatId: string) {
    states.delete(chatId);
}

export function updateConversationData(chatId: string, newData: Record<string, any>) {
    const current = states.get(chatId);
    if (current) {
        current.data = { ...current.data, ...newData };
        states.set(chatId, current);
    }
}


