"use strict";

const { minify } = require("terser");

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Reforms a JavaScript code.
 */
module.exports = async function minifyJs(inputJs: string, hash: string): Promise<string> {
    const cacheJs = await readProcessingCache(hash, "js");

    if (cacheJs) {
        return cacheJs.toString();
    }

    let outputJs;

    try {
        outputJs = await runCpuTask("js", inputJs, async () => {
            const result = await minify(inputJs, {
                mangle: false,
                compress: {
                    drop_console: true
                }
            });
            if (result.error) throw result.error;
            return result.code;
        });
    } catch(err) {
        if (err.statusCode === 503) throw err;
        logger.error("Compression error with terser", err);
        outputJs = inputJs;
    }

    await writeProcessingCache(outputJs, hash, "js");

    return outputJs;
}