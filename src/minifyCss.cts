"use strict";

const { minify } = require("csso");
const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Reforms a CSS style page with a CSS parser.
 *
 * @param {string} inputCss
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyCss(inputCss: string, hash: string): Promise<string> {
    const cacheCss = await readProcessingCache(hash, "css");

    if (cacheCss) {
        return cacheCss.toString();
    }

    let outputCss;
    try {
        outputCss = minify(inputCss, { restructure: false }).css;
    } catch(err) {
        logger.error("Css badly formatted", err);
        outputCss = inputCss;
    }

    await writeProcessingCache(outputCss, hash, "css");

    return outputCss;
};
