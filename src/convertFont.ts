"use strict";

const wawoff2 = require("wawoff2");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Converts a font into the woff2 format.
 */
module.exports = async function convertFont(inputFont: Buffer, hash: string): Promise<Buffer | null> {
    const cacheFont = await readProcessingCache(hash, "woff2");

    if (cacheFont) {
        return cacheFont;
    }

    let outputFont;

    try {
        outputFont = await runCpuTask("font", inputFont,
            async () => Buffer.from(await wawoff2.compress(inputFont)));
    } catch(err) {
        if (err.statusCode === 503) throw err;
        logger.error("Font conversion error", err);
        return null;
    }

    await writeProcessingCache(outputFont, hash, "woff2");

    return outputFont;
}