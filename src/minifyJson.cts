"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Reforms a json file.
 *
 * @param {string} inputJson
 * @param {string} hash
 * @returns {string}
 */
module.exports = function minifyJson(inputJson: string, hash: string): string {
    const cacheJson = readProcessingCache(hash, "json");

    if (cacheJson) {
        return cacheJson.toString();
    }

    let outputJson: string;

    try {
        outputJson = JSON.stringify(JSON.parse(inputJson));
    } catch (err) {
        logger.error("Json badly formatted", err);
        outputJson = inputJson;
    }

    writeProcessingCache(outputJson, hash, "json");

    return outputJson;
}