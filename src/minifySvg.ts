"use strict";

const { optimize } = require("svgo");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Reforms a SVG file.
 *
 * @param {string} inputSvg
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifySvg(inputSvg: string, hash: string): Promise<string> {
    const cacheSvg = await readProcessingCache(hash, "svg");

    if (cacheSvg) {
        return cacheSvg.toString();
    }

    let outputSvg;

    try {
        outputSvg = await runCpuTask("svg", inputSvg, () => optimize(inputSvg).data);
    } catch(err) {
        if (err.statusCode === 503) throw err;
        logger.error("Svg badly formatted", err);
        outputSvg = inputSvg;
    }

    await writeProcessingCache(outputSvg, hash, "svg");

    return outputSvg;
}