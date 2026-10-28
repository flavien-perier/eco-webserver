"use strict";

const configuration = require("./configuration.ts").default;

/**
 * Builds the response header.
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