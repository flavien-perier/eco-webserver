"use strict";

const configuration = require("./configuration").default;

/**
 * Builds the response header.
 *
 * @param {string} contentType
 * @param {boolean} useGzip
 * @param {string} etag
 * @returns {{[string]: string}}
 */
module.exports = function buildHeader(contentType, useGzip, etag) {
    const header = {
        ...configuration.header,
        "Content-Type": contentType,
    };

    if (useGzip) {
        header["Content-Encoding"] = "gzip";
    }

    if (etag) {
        header["ETag"] = etag;
    }

    return header;
}
