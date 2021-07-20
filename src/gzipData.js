"use strict";

const { gzipSync } = require("zlib");

/**
 * Compresses a resource with the `gzip` algorithm.
 *
 * @param {any} data
 * @returns {Buffer}
 */
module.exports = function gzipData(data) {
    return gzipSync(data, {
        level: 4
    });
}
