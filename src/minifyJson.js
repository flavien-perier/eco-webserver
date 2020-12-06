"use strict";

const uglifyJs = require("uglify-js");

const Logger = require("./Logger");
const logger = new Logger();

/**
 * Reforms a json file.
 *
 * @param {string} inputJson
 * @returns {string}
 */
module.exports = function minifyJs(inputJson) {
    try {
        return JSON.stringify(JSON.parse(inputJson));
    } catch (err) {
        logger.error("Json badly formatted", err);
        return inputJson;
    }
}
