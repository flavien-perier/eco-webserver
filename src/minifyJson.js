"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache");
const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a json file.
 *
 * @param {string} inputJson
 * @param {string} hash
 * @returns {string}
 */
module.exports = function minifyJs(inputJson, hash) {
    const cacheJson = readProcessingCache(hash, "json");

    if (cacheJson) {
        return cacheJson.toString();
    }

    let outputJson;

    try {
        outputJson = JSON.stringify(JSON.parse(inputJson));
    } catch (err) {
        logger.error("Json badly formatted", err);
        outputJson = inputJson;
    }

    writeProcessingCache(outputJson, hash, "json");

    return outputJson;
}
