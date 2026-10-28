"use strict";

const sharp = require("sharp");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Converts an image into the webp format.
 *
 * @param {Buffer} inputImage
 * @param {string} hash
 * @returns {Promise<Buffer | null>}
 */
module.exports = async function convertImage(inputImage: Buffer, hash: string): Promise<Buffer | null> {
    const cacheImage = await readProcessingCache(hash, "webp");

    if (cacheImage) {
        return cacheImage;
    }

    let outputImage;

    try {
        outputImage = await sharp(inputImage).rotate().webp({ quality: 80 }).toBuffer();
    } catch(err) {
        logger.error("Image conversion error", err);
        return null;
    }

    await writeProcessingCache(outputImage, hash, "webp");

    return outputImage;
}