"use strict";

const { createHash } = require("crypto");
const { minify } = require("html-minifier-terser");
const minifyCss = require("./minifyCss.cts");
const minifyJs = require("./minifyJs.cts");
const { writeProcessingCache, readProcessingCache } = require("./processingCache.cts");
const { runCpuTask } = require("./cpuPool.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();
const contentHash = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Reforms a HTML page with an HTML parser.
 *
 * @param {string} inputHtml
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyHtml(inputHtml: string, hash: string): Promise<string> {
    const cacheHtml = await readProcessingCache(hash, "html");

    if (cacheHtml) {
        return cacheHtml.toString();
    }

    let outputHtml;
    try {
        outputHtml = await runCpuTask("html", inputHtml, () => minify(inputHtml, {
            caseSensitive: true,
            collapseWhitespace: true,
            keepClosingSlash: true,
            minifyCSS: code => minifyCss(code, contentHash(code)),
            minifyJS: code => minifyJs(code, contentHash(code)),
            removeAttributeQuotes: true,
            removeComments: true,
            removeEmptyAttributes: true,
            removeScriptTypeAttributes: false,
            removeStyleLinkTypeAttributes: true,
        }));
    } catch(err) {
        logger.error("Html minification error", err);
        outputHtml = inputHtml;
    }

    await writeProcessingCache(outputHtml, hash, "html");

    return outputHtml;
};
