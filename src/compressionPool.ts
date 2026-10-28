"use strict";

const { Worker } = require("worker_threads");
const { join } = require("path");

const configuration = require("./configuration.ts").default;

const WORKER_PATH = join(__dirname, "compressionWorker.ts");
const configuredMaxQueue = Number(process.env.ECO_COMPRESSION_MAX_QUEUE ?? configuration.compressionMaxQueue ?? 100);
const COMPRESSION_MAX_QUEUE = Number.isFinite(configuredMaxQueue) ? Math.max(0, Math.floor(configuredMaxQueue)) : 100;

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
         * @type {{data: string | Buffer, encoding?: "gzip" | "br", resolve: Function, reject: Function}[]}
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
         * @type {{encoding?: "gzip" | "br", resolve: Function, reject: Function} | null}
         */
        worker.currentTask = null;

        worker.on("message", (message: any) => {
            const task = worker.currentTask;
            worker.currentTask = null;

            this.idleWorkers.push(worker);
            this.drainQueue();

            if (task) {
                if (task.encoding === "gzip") {
                    task.resolve(Buffer.from(message.gzipData));
                } else if (task.encoding === "br") {
                    task.resolve(Buffer.from(message.brotliData));
                } else {
                    task.resolve({
                        gzipData: Buffer.from(message.gzipData),
                        brotliData: Buffer.from(message.brotliData)
                    });
                }
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
     * @param {{data: string | Buffer, encoding?: "gzip" | "br", resolve: Function, reject: Function}} task
     * @returns {void}
     */
    runTask(worker: Worker, task: { data: string | Buffer; encoding?: "gzip" | "br"; resolve: Function; reject: Function }): void {
        worker.currentTask = { encoding: task.encoding, resolve: task.resolve, reject: task.reject };

        worker.postMessage({ data: task.data, encoding: task.encoding });
    }

    /**
     * Compresses a text resource with `gzip` and `brotli`, or with only the
     * requested algorithm, inside a worker.
     *
     * @param {string | Buffer} data
     * @param {"gzip" | "br"} [encoding]
     * @returns {Promise<{gzipData: Buffer, brotliData: Buffer} | Buffer>}
     */
    compress(data: string | Buffer, encoding?: "gzip" | "br"): Promise<{ gzipData: Buffer; brotliData: Buffer } | Buffer> {
        return new Promise((resolve: Function, reject: Function) => {
            const task = { data, encoding, resolve, reject };
            this.queue.push(task);
            this.drainQueue();

            while (this.queue.length > 0 && this.workers.length < this.size) {
                this.addWorker();
            }

            const queueIndex = this.queue.indexOf(task);
            if (queueIndex !== -1 && this.queue.length > COMPRESSION_MAX_QUEUE) {
                this.queue.splice(queueIndex, 1);
                const error: any = new Error("Compression queue is full");
                error.statusCode = 503;
                reject(error);
            }
        });
    }
}

module.exports = {
    compressData,
    CompressionPool,
};
