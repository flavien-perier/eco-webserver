"use strict";

const { lstat, readFile } = require("fs/promises");
const { resolve, sep } = require("path");

const configuration = require("./configuration.ts").default;

const RAW_CACHE_MAX_ENTRIES = Math.max(1, Number(configuration.rawCacheMaxEntries) || 500);
const RAW_CACHE_MAX_SIZE = Math.max(1, Number(configuration.rawCacheMaxSize) || 50 * 1024 * 1024);
const CACHE_VALIDATION_INTERVAL = Math.max(1, Number(configuration.cacheValidationInterval) || 60 * 1000);

/**
 * Content and validation metadata of a cached local resource.
 */
type CachedResource = {
    data: Buffer;
    mtimeMs: number;
    lastValidated: number;
};

/**
 * Raw resources indexed by their absolute path, in least recently used order.
 */
const cache = new Map<string, CachedResource>();
let cacheSize = 0;

/**
 * Resource reads and revalidations currently in progress.
 */
const pendingResources = new Map<string, Promise<Buffer | null>>();

/**
 * Removes a cached resource and updates the tracked cache size.
 */
function removeCachedResource(filePath: string): void {
    const cachedResource = cache.get(filePath);
    if (!cachedResource) return;
    cache.delete(filePath);
    cacheSize -= cachedResource.data.length;
}

/**
 * Marks a cached resource as recently used.
 */
function touchCachedResource(filePath: string, cachedResource: CachedResource): void {
    cache.delete(filePath);
    cache.set(filePath, cachedResource);
}

/**
 * Stores a raw resource and evicts least recently used entries above the limits.
 */
function storeCachedResource(filePath: string, data: Buffer, mtimeMs: number): void {
    if (data.length > RAW_CACHE_MAX_SIZE) return;
    removeCachedResource(filePath);
    cache.set(filePath, { data, mtimeMs, lastValidated: Date.now() });
    cacheSize += data.length;

    while (cache.size > RAW_CACHE_MAX_ENTRIES || cacheSize > RAW_CACHE_MAX_SIZE) {
        removeCachedResource(cache.keys().next().value);
    }
}

/**
 * Loads or revalidates a resource, sharing the operation between concurrent callers.
 */
function getPendingResource(filePath: string, cachedResource?: CachedResource): Promise<Buffer | null> {
    const currentPending = pendingResources.get(filePath);
    if (currentPending) return currentPending;

    const pendingResource = (async (): Promise<Buffer | null> => {
        if (cachedResource && cache.get(filePath) === cachedResource) {
            try {
                const details = await lstat(filePath);
                if (details.isFile() && details.mtimeMs === cachedResource.mtimeMs) {
                    cachedResource.lastValidated = Date.now();
                    touchCachedResource(filePath, cachedResource);
                    return cachedResource.data;
                }
            } catch(err) {
                if (err.code !== "ENOENT") {
                    removeCachedResource(filePath);
                    throw err;
                }
            }
            removeCachedResource(filePath);
        }

        try {
            const details = await lstat(filePath);
            if (!details.isFile()) return null;
            const data = await readFile(filePath);
            storeCachedResource(filePath, data, details.mtimeMs);
            return data;
        } catch(err) {
            if (err.code === "ENOENT") return null;
            throw err;
        }
    })().finally(() => {
        pendingResources.delete(filePath);
    });

    pendingResources.set(filePath, pendingResource);
    return pendingResource;
}

/**
 * Reads a local sub-resource without following paths outside distDir or symlinks.
 */
async function readLocalResource(pathname: string): Promise<Buffer | null> {
    let filePath: string;
    try {
        const distDir = resolve(configuration.distDir);
        filePath = resolve(distDir, `.${decodeURIComponent(pathname)}`);
        if (filePath !== distDir && !filePath.startsWith(distDir + sep)) return null;
    } catch(err) {
        return null;
    }

    const cachedResource = cache.get(filePath);
    if (cachedResource && Date.now() - cachedResource.lastValidated < CACHE_VALIDATION_INTERVAL) {
        touchCachedResource(filePath, cachedResource);
        return cachedResource.data;
    }

    return getPendingResource(filePath, cachedResource);
}

module.exports = {
    readLocalResource,
};
