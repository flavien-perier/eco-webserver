"use strict";

const { Worker } = require("worker_threads");
const { join } = require("path");

const WORKER_PATH = join(__dirname, "compressionWorker.cts");

/**
 * Compresses a text resource with the `gzip` and `brotli` algorithms.
 * Executed inside a worker.
 *
 * @param {string | Buffer} data
 * @returns {{gzipData: Buffer, brotliData: Buffer}}
 */
function compressData(data: string | Buffer): { gzipData: Buffer; brotliData: Buffer } {
    const { gzipSync, brotliCompressSync, constants } = require("zlib");

    return {
        gzipData: gzipSync(data, { level: 4 }),
        brotliData: brotliCompressSync(data, {
            params: {
                [constants.BROTLI_PARAM_QUALITY]: 4
            }
        })
    };
}

/**
 * Pool of compression workers keeping the main event loop free
 * during the `gzip` and `brotli` compression of the text resources.
 */
class CompressionPool {
    /**
     * @param {number} size Number of workers of the pool.
     */
    constructor(size: number) {
        /**
         * @type {number}
         */
        this.size = size;

        /**
         * @type {Worker[]}
         */
        this.workers = [];

        /**
         * Idle workers usable for a new task.
         *
         * @type {Worker[]}
         */
        this.idleWorkers = [];

        /**
         * Tasks waiting for a free worker.
         *
         * @type {{data: string | Buffer, resolve: Function, reject: Function}[]}
         */
        this.queue = [];
    }

    /**
     * Creates a worker of the pool and listens to its responses.
     *
     * @returns {Worker}
     */
    createWorker(): Worker {
        const worker = new Worker(WORKER_PATH);

        /**
         * Task currently executed by the worker.
         *
         * @type {{resolve: Function, reject: Function} | null}
         */
        worker.currentTask = null;

        worker.on("message", (message: any) => {
            const task = worker.currentTask;
            worker.currentTask = null;

            this.idleWorkers.push(worker);
            this.drainQueue();

            if (task) {
                task.resolve({
                    gzipData: Buffer.from(message.gzipData),
                    brotliData: Buffer.from(message.brotliData)
                });
            }
        });

        worker.on("error", (err: Error) => {
            const task = worker.currentTask;
            worker.currentTask = null;

            // Replaces the failing worker to keep the size of the pool.
            this.removeWorker(worker);

            if (this.workers.length < this.size) {
                this.addWorker();
            }

            if (task) {
                task.reject(err);
            }
        });

        worker.on("exit", () => {
            if (!this.workers.includes(worker)) return;
            const task = worker.currentTask;
            worker.currentTask = null;
            this.removeWorker(worker);

            if (this.workers.length < this.size) this.addWorker();
            if (task) task.reject(new Error("Compression worker exited before completing its task"));
        });

        return worker;
    }

    /**
     * Adds a new worker to the pool.
     *
     * @returns {void}
     */
    addWorker(): void {
        const worker = this.createWorker();
        this.workers.push(worker);
        this.idleWorkers.push(worker);
        this.drainQueue();
    }

    /**
     * Removes a worker of the pool.
     *
     * @param {Worker} worker
     * @returns {void}
     */
    removeWorker(worker: Worker): void {
        this.workers = this.workers.filter(w => w !== worker);
        this.idleWorkers = this.idleWorkers.filter(w => w !== worker);
    }

    /**
     * Sends queued tasks to the idle workers.
     *
     * @returns {void}
     */
    drainQueue(): void {
        while (this.queue.length > 0 && this.idleWorkers.length > 0) {
            const worker = this.idleWorkers.shift();
            const task = this.queue.shift();
            this.runTask(worker, task);
        }
    }

    /**
     * Sends a task to a worker.
     *
     * @param {Worker} worker
     * @param {{data: string | Buffer, resolve: Function, reject: Function}} task
     * @returns {void}
     */
    runTask(worker: Worker, task: { data: string | Buffer; resolve: Function; reject: Function }): void {
        worker.currentTask = { resolve: task.resolve, reject: task.reject };

        worker.postMessage(task.data);
    }

    /**
     * Compresses a text resource with `gzip` and `brotli` inside a worker.
     *
     * @param {string | Buffer} data
     * @returns {Promise<{gzipData: Buffer, brotliData: Buffer}>}
     */
    compress(data: string | Buffer): Promise<{ gzipData: Buffer; brotliData: Buffer }> {
        return new Promise((resolve: Function, reject: Function) => {
            this.queue.push({ data, resolve, reject });
            this.drainQueue();

            while (this.queue.length > 0 && this.workers.length < this.size) {
                this.addWorker();
            }
        });
    }
}

module.exports = {
    compressData,
    CompressionPool,
};