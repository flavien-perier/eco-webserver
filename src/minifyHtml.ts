"use strict";

const { minify } = require("html-minifier-terser");
const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const { HTML_MINIFY_OPTIONS } = require("./minifierOptions.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Reforms a HTML page with an HTML parser. A failed minification serves the
 * original page without persisting it, so a transient failure is retried.
 */
module.exports = async function minifyHtml(inputHtml: string, hash: string): Promise<string> {
    const cacheHtml = await readProcessingCache(hash, "html");

    if (cacheHtml) {
        return cacheHtml.toString();
    }

    let outputHtml;
    try {
        outputHtml = await runCpuTask("html", inputHtml, () => minify(inputHtml, HTML_MINIFY_OPTIONS));
    } catch(err) {
        if (err.statusCode === 503) throw err;
        logger.error("Html minification error", err);
        return inputHtml;
    }

    await writeProcessingCache(outputHtml, hash, "html");

    return outputHtml;
};
