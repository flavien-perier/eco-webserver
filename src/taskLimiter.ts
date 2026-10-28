"use strict";

/**
 * Bounded asynchronous task scheduler used to apply backpressure to cold work.
 */
class TaskLimiter {
    concurrency: number;
    maxQueue: number;
    active: number = 0;
    queue: Array<{
        task: () => Promise<any>;
        resolve: Function;
        reject: Function;
    }> = [];

    /**
     * @param {number} concurrency
     * @param {number} maxQueue
     */
    constructor(concurrency: number, maxQueue: number) {
        this.concurrency = concurrency;
        this.maxQueue = maxQueue;
    }

    /**
     * Runs a task now or queues it within the configured bound.
     *
     * @param {() => Promise<any>} task
     * @returns {Promise<any>}
     */
    run(task: () => Promise<any>): Promise<any> {
        if (this.active >= this.concurrency && this.queue.length >= this.maxQueue) {
            const error: any = new Error("Processing queue is full");
            error.statusCode = 503;
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.drain();
        });
    }

    /**
     * Starts queued tasks while slots are available.
     *
     * @returns {void}
     */
    drain(): void {
        while (this.active < this.concurrency && this.queue.length > 0) {
            const entry = this.queue.shift();
            this.active++;
            Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
                this.active--;
                this.drain();
            });
        }
    }
}

module.exports = TaskLimiter;
