"use strict";

const configuration = require("./configuration").default;

/**
 * Gives the "content-type" of a resource according to its extension.
 *
 * @param {string} filePath
 * @returns {string}
 */
module.exports = function getContentType(filePath) {
    const parsing = /\.([a-zA-Z0-9]+)$/.exec(filePath);

    if (!parsing) {
        return configuration.contentType.html;
    }

    const extension = parsing[1];

    if (extension && configuration.contentType[extension]) {
        return configuration.contentType[extension];
    }

    return configuration.contentType.text;
}
