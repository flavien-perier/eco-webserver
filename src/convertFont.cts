"use strict";

const wawoff2 = require("wawoff2");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Converts a font into the woff2 format.
 *
 * @param {Buffer} inputFont
 * @param {string} hash
 * @returns {Promise<Buffer | null>}
 */
module.exports = async function convertFont(inputFont: Buffer, hash: string): Promise<Buffer | null> {
    const cacheFont = readProcessingCache(hash, "woff2");

    if (cacheFont) {
        return cacheFont;
    }

    let outputFont;

    try {
        outputFont = Buffer.from(await wawoff2.compress(inputFont));
    } catch(err) {
        logger.error("Font conversion error", err);
        return null;
    }

    await writeProcessingCache(outputFont, hash, "woff2");

    return outputFont;
}