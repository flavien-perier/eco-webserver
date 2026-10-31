"use strict";

const { createHash } = require("crypto");
const { minify } = require("html-minifier-terser");
const minifyCss = require("./minifyCss.ts");
const minifyJs = require("./minifyJs.ts");
const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const { HTML_MINIFY_OPTIONS } = require("./minifierOptions.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();
const contentHash = (content: string): string => createHash("sha256").update(content).digest("hex");

/**
 * Reforms a HTML page with an HTML parser.
 */
module.exports = async function minifyHtml(inputHtml: string, hash: string): Promise<string> {
    const cacheHtml = await readProcessingCache(hash, "html");

    if (cacheHtml) {
        return cacheHtml.toString();
    }

    let outputHtml;
    try {
        outputHtml = await runCpuTask("html", inputHtml, () => minify(inputHtml, {
            ...HTML_MINIFY_OPTIONS,
            minifyCSS: code => minifyCss(code, contentHash(code)),
            minifyJS: code => minifyJs(code, contentHash(code)),
        }));
    } catch(err) {
        logger.error("Html minification error", err);
        outputHtml = inputHtml;
    }

    await writeProcessingCache(outputHtml, hash, "html");

    return outputHtml;
};
