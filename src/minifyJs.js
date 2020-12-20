"use strict";

const uglifyJs = require("uglify-js");
const { minify } = require("terser");

const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a JavaScript code.
 *
 * @param {string} inputJs
 * @returns {Promise<string>}
 */
module.exports = async function minifyJs(inputJs) {
    const result = await minify(inputJs, { 
        mangle: false,
        compress: {
            drop_console: true
        }
    });
    if (result.error) {
        logger.error("Compression error with terser", result.error);
        return inputJs;
    }
    return result.code;
}