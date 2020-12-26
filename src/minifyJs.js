"use strict";

const { minify } = require("terser");

const { writeProcessingCache, readProcessingCache } = require("./processingCache");
const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a JavaScript code.
 *
 * @param {string} inputJs
 * @returns {Promise<string>}
 */
module.exports = async function minifyJs(inputJs) {
    const cacheJs = readProcessingCache(inputJs, "js");

    if (cacheJs) {
        return cacheJs;
    }

    const result = await minify(inputJs, { 
        mangle: false,
        compress: {
            drop_console: true
        }
    });
    let outputJs = "";

    if (result.error) {
        logger.error("Compression error with terser", result.error);
        outputJs = inputJs;
    } else {
        outputJs = result.code;
    }

    writeProcessingCache(inputJs, outputJs, "js");

    return outputJs;
}