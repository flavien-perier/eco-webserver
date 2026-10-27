"use strict";

const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

const configuration = require("./configuration.cts").default;

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

    if (!existsSync(configuration.cacheDir)) {
        mkdirSync(configuration.cacheDir, { recursive: true });
    }

    writeFileSync(cacheLocation, afterProcessing);
}

/**
 * Recovers a cache treatment.
 *
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {Buffer | null}
 */
function readProcessingCache(hash: string, fileFormat: string): Buffer | null {
    const cacheLocation = fileCacheDir(hash, fileFormat);

    if (!existsSync(cacheLocation)) {
        return null;
    }

    return readFileSync(cacheLocation);
}

/**
 * Gives the location of the cached file.
 *
 * @param {string} hash
 * @param {string} fileFormat
 * @returns {string}
 */
function fileCacheDir(hash: string, fileFormat: string): string {
    return join(configuration.cacheDir, `${hash}.${fileFormat}`);
}

module.exports = {
    writeProcessingCache,
    readProcessingCache,
};