"use strict";

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

const configuration = require("./configuration").default;

/**
 * Pushes a treatment into the cache.
 *
 * @param {string | Buffer} afterProcessing
 * @param {string} fileFormat
 * @returns {void}
 */
async function writeProcessingCache(afterProcessing, hash, fileFormat) {
    const cacheLocation = fileCacheDir(hash, fileFormat);

    if (!existsSync(configuration.cacheDir)) {
        mkdirSync(configuration.cacheDir, { recursive: true });
    }

    writeFileSync(cacheLocation, afterProcessing);
}

/**
 * Recovers a cache treatment.
 *
 * @param {string} fileFormat
 * @param {string} fileFormat
 * @returns {Buffer | null}
 */
function readProcessingCache(hash, fileFormat) {
    const cacheLocation = fileCacheDir(hash, fileFormat);

    if (!existsSync(cacheLocation)) {
        return null;
    }

    return readFileSync(cacheLocation);
}

/**
 * Gives the location of the cached file.
 *
 * @param {string | Buffer} beforeProcessing
 * @param {string} fileFormat
 * @returns {string}
 */
function fileCacheDir(hash, fileFormat) {
    return join(configuration.cacheDir, `${hash}.${fileFormat}`);
}

module.exports = {
    writeProcessingCache,
    readProcessingCache
};
