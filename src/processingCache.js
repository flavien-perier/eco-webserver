"use strict";

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { createHash } = require("crypto");
const { join } = require("path");

const configuration = require("./configuration").default;

/**
 * Pushes a treatment into the cache.
 *
 * @param {string} beforeProcessing
 * @param {string} afterProcessing
 * @param {string} fileFormat
 * @returns {Promise<null>}
 */
async function writeProcessingCache(beforeProcessing, afterProcessing, fileFormat) {
    const cacheName = makeCacheName(beforeProcessing, fileFormat);

    if (!existsSync(configuration.cacheDir)) {
        mkdirSync(configuration.cacheDir, { recursive: true });
    }

    writeFileSync(cacheName, afterProcessing);
}

/**
 * Recovers a cache treatment.
 *
 * @param {string} beforeProcessing
 * @param {string} fileFormat
 * @returns {string | null}
 */
function readProcessingCache(beforeProcessing, fileFormat) {
    const cacheName = makeCacheName(beforeProcessing, fileFormat);

    if (!existsSync(cacheName)) {
        return null;
    }

    return readFileSync(cacheName).toString();
}

/**
 * Gives the name of the cached file.
 *
 * @param {string} beforeProcessing
 * @param {string} fileFormat
 * @returns {string}
 */
function makeCacheName(beforeProcessing, fileFormat) {
    const baseName = createHash("sha256").update(beforeProcessing || "").digest("hex");

    return join(configuration.cacheDir, `${baseName}.${fileFormat}`);
}

module.exports = {
    writeProcessingCache,
    readProcessingCache
};
