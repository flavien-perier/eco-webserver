"use strict";

const sharp = require("sharp");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Converts an image into the webp format.
 */
module.exports = async function convertImage(inputImage: Buffer, hash: string): Promise<Buffer | null> {
    const cacheImage = await readProcessingCache(hash, "webp");

    if (cacheImage) {
        return cacheImage;
    }

    let outputImage;

    try {
        const { format, pages = 1 } = await sharp(inputImage).metadata();
        if (pages > 1 && format !== "gif") {
            // A multi-page document (TIFF) is not an animation: keep the original.
            return null;
        }
        // Animated GIFs keep every frame; EXIF orientation only applies to still images.
        outputImage = pages > 1
            ? await sharp(inputImage, { animated: true }).webp({ quality: 80 }).toBuffer()
            : await sharp(inputImage).rotate().webp({ quality: 80 }).toBuffer();
    } catch(err) {
        logger.error("Image conversion error", err);
        return null;
    }

    await writeProcessingCache(outputImage, hash, "webp");

    return outputImage;
}