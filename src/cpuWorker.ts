"use strict";

const { parentPort } = require("worker_threads");
const { minify } = require("terser");
const { minify: minifyHtmlDocument } = require("html-minifier-terser");
const csso = require("csso");
const { optimize } = require("svgo");
const wawoff2 = require("wawoff2");
const minifyXmlText = require("./minifyXmlText.ts");

/**
 * Executes a CPU-heavy operation without loading the application configuration.
 */
async function execute(operation: string, input: string | Buffer): Promise<string | Buffer> {
    switch(operation) {
        case "html":
            return minifyHtmlDocument(input, {
                caseSensitive: true,
                collapseWhitespace: true,
                keepClosingSlash: true,
                minifyCSS: async code => csso.minify(code, { restructure: false }).css,
                minifyJS: async code => {
                    const result = await minify(code, {
                        mangle: false,
                        compress: { drop_console: true }
                    });
                    if (result.error) throw result.error;
                    return result.code;
                },
                removeAttributeQuotes: true,
                removeComments: true,
                removeEmptyAttributes: true,
                removeScriptTypeAttributes: false,
                removeStyleLinkTypeAttributes: true,
            });
        case "js": {
            const result = await minify(input, {
                mangle: false,
                compress: {
                    drop_console: true
                }
            });
            if (result.error) throw result.error;
            return result.code;
        }
        case "css":
            return csso.minify(input, { restructure: false }).css;
        case "svg":
            return optimize(input).data;
        case "json":
            return JSON.stringify(JSON.parse(input as string));
        case "xml":
            return minifyXmlText(input as string);
        case "font":
            return Buffer.from(await wawoff2.compress(input));
        default:
            throw new Error(`Unknown CPU operation: ${operation}`);
    }
}

parentPort.on("message", async ({ id, operation, input }) => {
    try {
        const result = await execute(operation, input);
        parentPort.postMessage({ id, result });
    } catch(err) {
        parentPort.postMessage({
            id,
            error: {
                name: err.name,
                message: err.message,
                stack: err.stack,
                code: err.code
            }
        });
    }
});
