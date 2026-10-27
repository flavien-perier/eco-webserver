"use strict";

const { optimize } = require("svgo");

const { writeProcessingCache, readProcessingCache } = require("./processingCache");
const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a SVG file.
 *
 * @param {string} inputSvg
 * @param {string} hash
 * @returns {string}
 */
module.exports = function minifySvg(inputSvg, hash) {
    const cacheSvg = readProcessingCache(hash, "svg");

    if (cacheSvg) {
        return cacheSvg.toString();
    }

    let outputSvg;

    try {
        outputSvg = optimize(inputSvg).data;
    } catch(err) {
        logger.error("Svg badly formatted", err);
        outputSvg = inputSvg;
    }

    writeProcessingCache(outputSvg, hash, "svg");

    return outputSvg;
}