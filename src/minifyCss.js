"use strict";

/**
 * @param {string} inputCss
 * @returns {string}
 */
module.exports = function minifyCss(inputCss) {
    return inputCss
        // Deletes comments
        .replace(/\/\*.*?\*\//gs, "")
        // Removes spaces at the beginning of the line.
        .replace(/^\s*/gm, "")
        // Deletes new lines.
        .replace(/[\n|\t]/g, "")
        // Removes the spaces between the key and the value.
        .replace(/\s*:\s*/gm, ":")
        // Opening blocks.
        .replace(/\s*{\s*/gm, "{")
        // Closing blocks.
        .replace(/;?\s*}\s*/gm, "}");
}
