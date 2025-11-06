import { log } from './logger.js';

type SyncTask = {
    chatId: string;
    sourceUrl: string;
    resolve: (value: { added: number; skipped: number; excluded: number }) => void;
    reject: (error: any) => void;
};

class SyncQueue {
    private queue: SyncTask[] = [];
    private running = 0;
    private maxConcurrency = 5;
    private syncFunction: ((chatId: string, sourceUrl: string) => Promise<{ added: number; skipped: number; excluded: number }>) | null = null;

    setSyncFunction(fn: (chatId: string, sourceUrl: string) => Promise<{ added: number; skipped: number; excluded: number }>) {
        this.syncFunction = fn;
    }

    async enqueue(chatId: string, sourceUrl: string): Promise<{ added: number; skipped: number; excluded: number }> {
        return new Promise((resolve, reject) => {
            this.queue.push({ chatId, sourceUrl, resolve, reject });
            this.process();
        });
    }

    private async process() {
        if (this.running >= this.maxConcurrency || this.queue.length === 0) {
            return;
        }

        const task = this.queue.shift();
        if (!task) return;

        this.running++;
        log.info(`[SyncQueue] Starting sync for chat ${task.chatId} (${this.running}/${this.maxConcurrency} active)`);

        try {
            if (!this.syncFunction) {
                task.reject(new Error('Sync function not set'));
                return;
            }
            const result = await this.syncFunction(task.chatId, task.sourceUrl);
            task.resolve(result);
        } catch (error) {
            log.error(`[SyncQueue] Sync failed for chat ${task.chatId}:`, error);
            task.reject(error);
        } finally {
            this.running--;
            log.info(`[SyncQueue] Completed sync for chat ${task.chatId} (${this.running}/${this.maxConcurrency} active, ${this.queue.length} queued)`);
            this.process(); // Process next task
        }
    }

    getStatus() {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrency: this.maxConcurrency,
        };
    }
}

export const syncQueue = new SyncQueue();

