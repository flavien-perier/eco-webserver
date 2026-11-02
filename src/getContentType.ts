"use strict";

const configuration = require("./configuration.ts").default;

/**
 * Gives the "content-type" of a resource according to its extension.
 */
module.exports = function getContentType(filePath: string): string {
    const parsing = /\.([a-zA-Z0-9]+)$/.exec(filePath);

    if (!parsing) {
        return configuration.contentType.html;
    }

    const extension = parsing[1].toLowerCase();

    if (extension && configuration.contentType[extension]) {
        return configuration.contentType[extension];
    }

    return configuration.contentType.text;
}