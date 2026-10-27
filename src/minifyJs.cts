"use strict";

const { minify } = require("terser");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Reforms a JavaScript code.
 *
 * @param {string} inputJs
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyJs(inputJs: string, hash: string): Promise<string> {
    const cacheJs = readProcessingCache(hash, "js");

    if (cacheJs) {
        return cacheJs.toString();
    }

    let result;

    try {
        result = await minify(inputJs, {
            mangle: false,
            compress: {
                drop_console: true
            }
        });
    } catch(err) {
        result = { error: err };
    }

    let outputJs;

    if (result.error) {
        logger.error("Compression error with terser", result.error);
        outputJs = inputJs;
    } else {
        outputJs = result.code;
    }

    writeProcessingCache(outputJs, hash, "js");

    return outputJs;
}