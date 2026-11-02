"use strict";

const { Worker } = require("worker_threads");
const { join } = require("path");

const configuration = require("./configuration.ts").default;

const CPU_WORKER_THRESHOLD = nonNegativeInteger(
    process.env.ECO_CPU_WORKER_THRESHOLD ?? configuration.cpuWorkerThreshold,
    64 * 1024
);
const CPU_POOL_SIZE = positiveInteger(
    process.env.ECO_CPU_POOL_SIZE ?? configuration.cpuPoolSize,
    2
);
const CPU_MAX_QUEUE = nonNegativeInteger(configuration.cpuMaxQueue, 100);

const workers = [];
const queue = [];
let nextTaskId = 1;

function nonNegativeInteger(value: any, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function positiveInteger(value: any, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

/**
 * Runs small inputs locally and sends larger inputs to the bounded worker pool.
 */
async function runCpuTask(operation: string, input: string | Buffer, localTask: () => any): Promise<any> {
    const inputSize = typeof input === "string" ? Buffer.byteLength(input) : input.length;
    if (inputSize <= CPU_WORKER_THRESHOLD) return localTask();
    return enqueue(operation, input);
}

function enqueue(operation: string, input: string | Buffer): Promise<any> {
    return new Promise((resolve, reject) => {
        const canStartImmediately = workers.length < CPU_POOL_SIZE
            || workers.some(slot => slot.current === null);

        if (!canStartImmediately && queue.length >= CPU_MAX_QUEUE) {
            const error: any = new Error("CPU worker queue is full");
            error.statusCode = 503;
            reject(error);
            return;
        }

        queue.push({ id: nextTaskId++, operation, input, resolve, reject });
        dispatch();
    });
}

/**
 * Fills every immediately available worker slot.
 */
function dispatch(): void {
    while(queue.length > 0) {
        let slot = workers.find(candidate => candidate.current === null);

        if (!slot) {
            if (workers.length >= CPU_POOL_SIZE) return;
            slot = createWorker();
        }

        const task = queue.shift();
        slot.current = task;
        slot.worker.ref();
        slot.worker.postMessage({
            id: task.id,
            operation: task.operation,
            input: task.input
        });
    }
}

/**
 * Creates one lazy worker and binds its lifecycle to a single slot.
 */
function createWorker(): { worker: any; current: any; failed: boolean } {
    const slot = {
        worker: new Worker(join(__dirname, "cpuWorker.ts")),
        current: null,
        failed: false
    };
    workers.push(slot);

    slot.worker.on("message", response => {
        const task = slot.current;
        if (!task || task.id !== response.id) return;

        slot.current = null;
        slot.worker.unref();
        dispatch();

        if (response.error) {
            task.reject(deserializeError(response.error));
        } else {
            const result = response.result;
            task.resolve(result instanceof Uint8Array ? Buffer.from(result) : result);
        }
    });

    slot.worker.on("error", err => failWorker(slot, err));
    slot.worker.on("exit", code => {
        if (!slot.failed) failWorker(slot, new Error(`CPU worker exited with code ${code}`));
    });

    return slot;
}

/**
 * Rejects the active task and transparently replaces a failed worker lazily.
 */
function failWorker(slot: { worker: any; current: any; failed: boolean }, err: Error): void {
    if (slot.failed) return;
    slot.failed = true;

    const index = workers.indexOf(slot);
    if (index !== -1) workers.splice(index, 1);

    const task = slot.current;
    slot.current = null;
    if (task) task.reject(err);

    slot.worker.terminate().catch(() => {});
    dispatch();
}

function deserializeError(source: { name?: string; message?: string; stack?: string; code?: string }): Error {
    const error: any = new Error(source.message);
    error.name = source.name || "Error";
    error.stack = source.stack;
    error.code = source.code;
    return error;
}

module.exports = { runCpuTask };
