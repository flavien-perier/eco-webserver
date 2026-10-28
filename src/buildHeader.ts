"use strict";

const configuration = require("./configuration.ts").default;

/**
 * Builds the response header.
 *
 * @param {string} contentType
 * @param {"br" | "gzip" | false} encoding
 * @param {string} etag
 * @returns {{[header: string]: string}}
 */
module.exports = function buildHeader(contentType: string, encoding: "br" | "gzip" | false, etag: string): { [header: string]: string } {
    const header: { [header: string]: string } = {
        ...configuration.header,
        "Content-Type": contentType,
        "Vary": "Accept-Encoding",
    };

    if (encoding) {
        header["Content-Encoding"] = encoding;
    }

    if (etag) {
        header["ETag"] = etag;
    }

    return header;
}