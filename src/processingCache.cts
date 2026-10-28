"use strict";

const { randomUUID } = require("crypto");
const { mkdir, readFile, readdir, rename, stat, unlink, writeFile } = require("fs/promises");
const { join } = require("path");

const configuration = require("./configuration.cts").default;

const CACHE_VERSION = "v2";
const DISK_CACHE_MAX_SIZE = Math.max(1, Number(process.env.ECO_DISK_CACHE_MAX_SIZE || configuration.diskCacheMaxSize) || 512 * 1024 * 1024);
const CLEANUP_INTERVAL = Math.max(0, Number(configuration.diskCacheCleanupInterval ?? 60 * 60 * 1000));
const configuredWriteMaxQueue = Number(configuration.diskWriteMaxQueue);
const DISK_WRITE_MAX_QUEUE = Number.isFinite(configuredWriteMaxQueue) && configuredWriteMaxQueue >= 0 ? Math.floor(configuredWriteMaxQueue) : 100;
const configuredWriteConcurrency = Number(configuration.diskWriteConcurrency);
const DISK_WRITE_CONCURRENCY = Number.isFinite(configuredWriteConcurrency) && configuredWriteConcurrency >= 1 ? Math.floor(configuredWriteConcurrency) : 2;
const CLEANUP_STAT_CONCURRENCY = 32;

let lastCleanup = 0;
let cleanupPromise: Promise<void> | null = null;
const writeQueue = [];
const queuedWrites = new Map();
const activeWrites = new Set<Promise<void>>();

/**
 * Removes the least recently modified processing artefacts above the size limit.
 *
 * @param {number} maxSize
 * @returns {Promise<void>}
 */
async function cleanProcessingCache(maxSize: number = DISK_CACHE_MAX_SIZE): Promise<void> {
    let files;
    try {
        files = await readdir(configuration.cacheDir);
    } catch(err) {
        if (err.code === "ENOENT") return;
        throw err;
    }

    const filesToStat = files.filter(file => file.startsWith(`${CACHE_VERSION}-`) && !file.endsWith(".tmp"));
    const entries = [];
    let nextFileIndex = 0;

    const statFiles = async () => {
        while (nextFileIndex < filesToStat.length) {
            const file = filesToStat[nextFileIndex++];
            const path = join(configuration.cacheDir, file);
            try {
                const details = await stat(path);
                entries.push({ path, size: details.size, mtimeMs: details.mtimeMs });
            } catch(err) {
                // Files can disappear while the cleanup is running.
            }
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(CLEANUP_STAT_CONCURRENCY, filesToStat.length) },
        () => statFiles()
    ));

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalSize = entries.reduce((total, entry) => total + entry.size, 0);

    for (let index = entries.length - 1; index >= 0 && totalSize > maxSize; index--) {
        try {
            await unlink(entries[index].path);
            totalSize -= entries[index].size;
        } catch(err) {
            if (err.code !== "ENOENT") throw err;
        }
    }
}

/**
 * Schedules a single cache cleanup at a time without waiting for it.
 */
function scheduleCleanup(): void {
    if (Date.now() - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = Date.now();

    if (!cleanupPromise) {
        cleanupPromise = cleanProcessingCache()
            .catch(() => {})
            .finally(() => {
                cleanupPromise = null;
            });
    }
}

/**
 * Atomically writes one queued cache entry.
 *
 * @param {{afterProcessing: string | Buffer, cacheLocation: string, temporaryLocation: string}} task
 * @returns {Promise<void>}
 */
async function writeCacheEntry(task): Promise<void> {
    await mkdir(configuration.cacheDir, { recursive: true });

    try {
        await writeFile(task.temporaryLocation, task.afterProcessing);
        await rename(task.temporaryLocation, task.cacheLocation);
    } finally {
        await unlink(task.temporaryLocation).catch(() => {});
    }
}

/**
 * Starts queued writes up to the configured concurrency.
 */
function pumpWriteQueue(): void {
    while (activeWrites.size < DISK_WRITE_CONCURRENCY && writeQueue.length > 0) {
        const task = writeQueue.shift();
        const writePromise = writeCacheEntry(task)
            .catch(() => {})
            .finally(() => {
                activeWrites.delete(writePromise);
                queuedWrites.delete(task.key);
                pumpWriteQueue();
                scheduleCleanup();
            });
        activeWrites.add(writePromise);
    }
}

/**
 * Pushes a treatment into the cache without waiting for disk I/O.
 * Duplicate and overflowing writes are discarded on a best-effort basis.
 *
 * @param {string | Buffer} afterProcessing
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {Promise<void>}
 */
async function writeProcessingCache(afterProcessing: string | Buffer, hash: string, fileFormat: string): Promise<void> {
    const key = `${hash}.${fileFormat}`;
    if (queuedWrites.has(key) || writeQueue.length >= DISK_WRITE_MAX_QUEUE) return;

    const cacheLocation = fileCacheDir(hash, fileFormat);
    const task = {
        key,
        afterProcessing,
        cacheLocation,
        temporaryLocation: `${cacheLocation}.${process.pid}.${randomUUID()}.tmp`
    };

    writeQueue.push(task);
    queuedWrites.set(key, task);
    pumpWriteQueue();
}

/**
 * Waits for all cache writes and cleanups currently in progress.
 *
 * @returns {Promise<void>}
 */
async function flushProcessingCache(): Promise<void> {
    while (writeQueue.length > 0 || activeWrites.size > 0 || cleanupPromise) {
        const pending = Array.from(activeWrites);
        if (cleanupPromise) pending.push(cleanupPromise);
        await Promise.all(pending);
    }
}

/**
 * Recovers a cache treatment.
 *
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {Promise<Buffer | null>}
 */
async function readProcessingCache(hash: string, fileFormat: string): Promise<Buffer | null> {
    try {
        return await readFile(fileCacheDir(hash, fileFormat));
    } catch(err) {
        if (err.code === "ENOENT") return null;
        throw err;
    }
}

/**
 * Gives the location of the cached file.
 *
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {string}
 */
function fileCacheDir(hash: string, fileFormat: string): string {
    return join(configuration.cacheDir, `${CACHE_VERSION}-${hash}.${fileFormat}`);
}

module.exports = {
    cleanProcessingCache,
    writeProcessingCache,
    flushProcessingCache,
    readProcessingCache,
};
