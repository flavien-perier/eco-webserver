"use strict";

const uglifyJs = require("uglify-js");

const Logger = require("./Logger");
const logger = new Logger();

/**
 * @param {string} inputJs
 * @returns {string}
 */
module.exports = function minifyJs(inputJs) {
    const result = uglifyJs.minify(inputJs, { 
        compress: false,
        mangle: false
    });
    if (result.error) {
        logger.error("Compression error with UglifyJs", result.error);
        return inputJs;
    }
    return result.code;
}
