"use strict";

const { Worker } = require("worker_threads");
const { join, resolve } = require("path");

const configuration = require("./configuration.cts").default;

const WORKER_PATH = join(__dirname, "jsdomWorker.cts");
const JSDOM_CONCURRENCY = Math.max(1, Number(process.env.ECO_JSDOM_CONCURRENCY || configuration.jsdomConcurrency) || 2);
const JSDOM_MAX_QUEUE = Math.max(0, Number(configuration.jsdomMaxQueue ?? 100));
const JSDOM_RENDER_TIMEOUT = Math.max(1, Number(configuration.jsdomRenderTimeout) || 10000);
const SCRIPT_LOAD_CONCURRENCY = Math.max(1, Number(configuration.scriptLoadConcurrency) || 8);

const workerConfiguration = Object.freeze({
    port: configuration.port,
    distDir: resolve(configuration.distDir),
    proxyTimeout: Math.max(1, Number(process.env.ECO_PROXY_TIMEOUT || configuration.proxyTimeout) || 10000),
    proxyMaxSize: Math.max(1, Number(process.env.ECO_PROXY_MAX_SIZE || configuration.proxyMaxSize) || 50 * 1024 * 1024),
    scriptTimeout: Math.max(1, Number(configuration.scriptTimeout) || 1000),
    scriptLoadConcurrency: SCRIPT_LOAD_CONCURRENCY,
});

/**
 * @type {Worker[]}
 */
const workers = [];

/**
 * @type {Worker[]}
 */
const idleWorkers = [];

/**
 * @type {Array<{content: string, requestUrl: string, resolve: Function, reject: Function, timer: NodeJS.Timeout, worker: Worker | null, settled: boolean}>}
 */
const renderQueue = [];

/**
 * Settles a rendering task and clears its global deadline.
 *
 * @param {Object} task
 * @param {Error | null} err
 * @param {string | null} html
 * @returns {void}
 */
function settleTask(task: any, err: Error | null, html: string | null = null): void {
    if (task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);

    if (err) task.reject(err);
    else task.resolve(html);
}

/**
 * Removes and terminates a failed worker, then creates its replacement.
 *
 * @param {Worker} worker
 * @param {Error} err
 * @returns {void}
 */
function failWorker(worker: Worker, err: Error): void {
    if (!workers.includes(worker)) return;

    const task = worker.currentTask;
    worker.currentTask = null;

    const workerIndex = workers.indexOf(worker);
    workers.splice(workerIndex, 1);
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex !== -1) idleWorkers.splice(idleIndex, 1);

    void worker.terminate().catch(() => {});
    if (task) settleTask(task, err);

    // The initial pool is lazy, but an initialized worker is always replaced.
    const replacement = createWorker();
    workers.push(replacement);
    idleWorkers.push(replacement);
    drainQueue();
}

/**
 * Creates a worker processing one rendering at a time.
 *
 * @returns {Worker}
 */
function createWorker(): Worker {
    const worker = new Worker(WORKER_PATH);
    worker.currentTask = null;

    worker.on("message", (message: any) => {
        const task = worker.currentTask;
        if (!task) return;

        if (message && message.error) {
            const err = new Error(message.error.message || "jsdom worker rendering failed");
            if (message.error.stack) err.stack = message.error.stack;
            failWorker(worker, err);
            return;
        }

        worker.currentTask = null;
        settleTask(task, null, message.html);
        idleWorkers.push(worker);
        drainQueue();
    });

    worker.on("error", (err: Error) => failWorker(worker, err));
    worker.on("exit", () => {
        if (workers.includes(worker)) {
            failWorker(worker, new Error("jsdom worker exited before completing its task"));
        }
    });

    return worker;
}

/**
 * Assigns queued renderings to idle workers, creating workers lazily.
 *
 * @returns {void}
 */
function drainQueue(): void {
    while (renderQueue.length > 0) {
        let worker = idleWorkers.shift();
        if (!worker) {
            if (workers.length >= JSDOM_CONCURRENCY) break;
            worker = createWorker();
            workers.push(worker);
        }

        const task = renderQueue.shift();
        if (task.settled) {
            idleWorkers.push(worker);
            continue;
        }

        task.worker = worker;
        worker.currentTask = task;
        worker.postMessage({
            content: task.content,
            requestUrl: task.requestUrl,
            configuration: workerConfiguration,
        });
    }
}

/**
 * Renders HTML with jsdom in an isolated worker.
 *
 * @param {string} content
 * @param {string} requestUrl
 * @returns {Promise<string>}
 */
module.exports = async function renderJsdom(content: string, requestUrl: string): Promise<string> {
    return new Promise((resolveTask: Function, rejectTask: Function) => {
        if (idleWorkers.length === 0 && workers.length >= JSDOM_CONCURRENCY && renderQueue.length >= JSDOM_MAX_QUEUE) {
            const err: any = new Error("jsdom rendering queue is full");
            err.statusCode = 503;
            rejectTask(err);
            return;
        }

        const task: any = {
            content,
            requestUrl,
            resolve: resolveTask,
            reject: rejectTask,
            worker: null,
            settled: false,
            timer: null,
        };

        task.timer = setTimeout(() => {
            if (task.settled) return;

            const err: any = new Error(`jsdom rendering timed out after ${JSDOM_RENDER_TIMEOUT} ms`);
            err.statusCode = 504;

            if (task.worker) {
                failWorker(task.worker, err);
            } else {
                const queueIndex = renderQueue.indexOf(task);
                if (queueIndex !== -1) renderQueue.splice(queueIndex, 1);
                settleTask(task, err);
            }
        }, JSDOM_RENDER_TIMEOUT);

        renderQueue.push(task);
        drainQueue();
    });
};
