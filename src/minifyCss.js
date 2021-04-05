"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache");

const COMMENT_MATCHER = /\/\*.*?\*\//gs;
const BEGINNING_SAPCE_MATCHER = /^\s*/gm;
const NEW_LINE_MATCHER = /[\n|\t]/g;
const SPACE_BETWEEN_KEY_AND_VALUE_MATCHER = /\s*:\s*/gm;
const OPENING_BRACES_MATCHER = /\s*{\s*/gm;
const CLOSING_BRACES_MATCHER = /;?\s*}\s*/gm;

/**
 * Reforms a CSS style page.
 *
 * @param {string} inputCss
 * @param {string} hash
 * @returns {string}
 */
module.exports = function minifyCss(inputCss, hash) {
    const cacheCss = readProcessingCache(hash, "css");

    if (cacheCss) {
        return cacheCss.toString();
    }

    const outputCss = inputCss
        // Deletes comments
        .replace(COMMENT_MATCHER, "")
        // Removes spaces at the beginning of the line.
        .replace(BEGINNING_SAPCE_MATCHER, "")
        // Deletes new lines.
        .replace(NEW_LINE_MATCHER, "")
        // Removes the spaces between the key and the value.
        .replace(SPACE_BETWEEN_KEY_AND_VALUE_MATCHER, ":")
        // Opening braces.
        .replace(OPENING_BRACES_MATCHER, "{")
        // Closing braces.
        .replace(CLOSING_BRACES_MATCHER, "}");

    writeProcessingCache(outputCss, hash, "css");
    
    return outputCss;
}
