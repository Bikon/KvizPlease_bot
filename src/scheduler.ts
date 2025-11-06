import cron from 'node-cron';
import type { Bot } from 'grammy';

import { config } from './config.js';
import { listChatsWithSourceAndLastSync, setChatSetting } from './db/repositories.js';
import { syncGames } from './services/gameService.js';
import { log } from './utils/logger.js';

export function setupScheduler(bot: Bot) {
    // Проверяем ежечасно автосинк
    const task = cron.schedule('0 * * * *', async () => {
        try {
            const now = Date.now();
            
            // Автосинк (раз в неделю после последнего ручного)
            const syncRows = await listChatsWithSourceAndLastSync();
            for (const r of syncRows) {
                if (!r.last_sync_at) continue;
                const last = Date.parse(r.last_sync_at);
                if (!Number.isFinite(last)) continue;
                const weekMs = 7 * 24 * 60 * 60 * 1000;
                if (now - last >= weekMs) {
                    try {
                        const { added, skipped, excluded } = await syncGames(r.chat_id, r.source_url);
                        await bot.api.sendMessage(r.chat_id, '✅ Автоматическая синхронизация завершена.');
                        await bot.api.sendMessage(
                            r.chat_id,
                            `Добавлено игр: ${added}.\n` +
                            `Исключено из обработки: ${excluded}.\n` +
                            `Пропущено: ${skipped}.`
                        );
                        await setChatSetting(r.chat_id, 'last_sync_at', new Date().toISOString());
                    } catch (e) {
                        log.error('Auto sync failed for chat', r.chat_id, e);
                    }
                }
            }
        } catch (e) {
            log.error('Scheduler failed:', e);
        }
    }, { timezone: config.tz });

    return task;
}
