"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Reforms a json file.
 *
 * @param {string} inputJson
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyJson(inputJson: string, hash: string): Promise<string> {
    const cacheJson = await readProcessingCache(hash, "json");

    if (cacheJson) {
        return cacheJson.toString();
    }

    let outputJson: string;

    try {
        outputJson = await runCpuTask("json", inputJson, () => JSON.stringify(JSON.parse(inputJson)));
    } catch (err) {
        if (err.statusCode === 503) throw err;
        logger.error("Json badly formatted", err);
        outputJson = inputJson;
    }

    await writeProcessingCache(outputJson, hash, "json");

    return outputJson;
}