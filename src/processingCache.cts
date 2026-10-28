"use strict";

const { randomUUID } = require("crypto");
const { mkdir, readFile, readdir, rename, stat, unlink, writeFile } = require("fs/promises");
const { join } = require("path");

const configuration = require("./configuration.cts").default;

const CACHE_VERSION = "v2";
const DISK_CACHE_MAX_SIZE = Math.max(1, Number(process.env.ECO_DISK_CACHE_MAX_SIZE || configuration.diskCacheMaxSize) || 512 * 1024 * 1024);
const CLEANUP_INTERVAL = Math.max(0, Number(configuration.diskCacheCleanupInterval) || 60 * 60 * 1000);

let lastCleanup = 0;
let cleanupPromise: Promise<void> | null = null;

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

    const entries = (await Promise.all(files
        .filter(file => file.startsWith(`${CACHE_VERSION}-`) && !file.endsWith(".tmp"))
        .map(async file => {
            const path = join(configuration.cacheDir, file);
            try {
                const details = await stat(path);
                return { path, size: details.size, mtimeMs: details.mtimeMs };
            } catch(err) {
                return null;
            }
        }))).filter(entry => entry !== null);

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
 * Schedules a single cache cleanup at a time.
 *
 * @returns {Promise<void>}
 */
async function scheduleCleanup(): Promise<void> {
    if (Date.now() - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = Date.now();

    if (!cleanupPromise) {
        cleanupPromise = cleanProcessingCache().finally(() => {
            cleanupPromise = null;
        });
    }

    await cleanupPromise;
}

/**
 * Pushes a treatment into the cache.
 *
 * @param {string | Buffer} afterProcessing
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {Promise<void>}
 */
async function writeProcessingCache(afterProcessing: string | Buffer, hash: string, fileFormat: string): Promise<void> {
    const cacheLocation = fileCacheDir(hash, fileFormat);
    const temporaryLocation = `${cacheLocation}.${process.pid}.${randomUUID()}.tmp`;

    await mkdir(configuration.cacheDir, { recursive: true });

    try {
        await writeFile(temporaryLocation, afterProcessing);
        await rename(temporaryLocation, cacheLocation);
    } finally {
        await unlink(temporaryLocation).catch(() => {});
    }

    await scheduleCleanup();
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
    readProcessingCache,
};
