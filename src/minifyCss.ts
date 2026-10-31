"use strict";

const { minify } = require("csso");
const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const { CSS_MINIFY_OPTIONS } = require("./minifierOptions.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Reforms a CSS style page with a CSS parser.
 */
module.exports = async function minifyCss(inputCss: string, hash: string): Promise<string> {
    const cacheCss = await readProcessingCache(hash, "css");

    if (cacheCss) {
        return cacheCss.toString();
    }

    let outputCss;
    try {
        outputCss = await runCpuTask("css", inputCss,
            () => minify(inputCss, CSS_MINIFY_OPTIONS).css);
    } catch(err) {
        if (err.statusCode === 503) throw err;
        logger.error("Css badly formatted", err);
        outputCss = inputCss;
    }

    await writeProcessingCache(outputCss, hash, "css");

    return outputCss;
};
