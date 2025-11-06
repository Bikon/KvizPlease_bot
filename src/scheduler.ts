import cron from 'node-cron';
import { config } from './config.js';
import { log } from './utils/logger.js';
import { syncGames } from './services/gameService.js';
import { listChatsWithSourceAndLastSync, setChatSetting } from './db/repositories.js';
import type { Bot } from 'grammy';

export function setupScheduler(bot: Bot) {
    // Проверяем ежечасно, у каких чатов прошла неделя с последнего ручного /sync
    const task = cron.schedule('0 * * * *', async () => {
        try {
            const rows = await listChatsWithSourceAndLastSync();
            const now = Date.now();
            for (const r of rows) {
                if (!r.last_sync_at) continue; // счётчик запускается после ручного /sync
                const last = Date.parse(r.last_sync_at);
                if (!Number.isFinite(last)) continue;
                const weekMs = 7 * 24 * 60 * 60 * 1000;
                if (now - last >= weekMs) {
                    try {
                        const { added, skipped } = await syncGames(r.chat_id, r.source_url);
                        await bot.api.sendMessage(r.chat_id, '✅ Синхронизация завершена.');
                        await bot.api.sendMessage(r.chat_id, `Добавлено игр: ${added}. Пропущено: ${skipped}.`);
                        await setChatSetting(r.chat_id, 'last_sync_at', new Date().toISOString());
                    } catch (e) {
                        log.error('Auto sync failed for chat', r.chat_id, e);
                    }
                }
            }
        } catch (e) {
            log.error('Auto sync scheduler failed:', e);
        }
    }, { timezone: config.tz });

    return task;
}
