"use strict";

const configuration = require("./configuration").default;

/**
 * Builds the response header.
 *
 * @param {string} contentType
 * @param {"br" | "gzip" | false} encoding
 * @param {string} etag
 * @returns {{[string]: string}}
 */
module.exports = function buildHeader(contentType, encoding, etag) {
    const header = {
        ...configuration.header,
        "Content-Type": contentType,
    };

    if (encoding) {
        header["Content-Encoding"] = encoding;
    }

    if (etag) {
        header["ETag"] = etag;
    }

    return header;
}
