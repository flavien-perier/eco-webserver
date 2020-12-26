"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache");
const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a json file.
 *
 * @param {string} inputJson
 * @returns {string}
 */
module.exports = function minifyJs(inputJson) {
    const cacheJson = readProcessingCache(inputJson, "json");

    if (cacheJson) {
        return cacheJson;
    }

    let outputJson = "";

    try {
        outputJson = JSON.stringify(JSON.parse(inputJson));
    } catch (err) {
        logger.error("Json badly formatted", err);
        outputJson = inputJson;
    }

    writeProcessingCache(inputJson, outputJson, "json");

    return outputJson;
}
