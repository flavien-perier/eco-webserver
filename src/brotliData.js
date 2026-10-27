"use strict";

const { brotliCompressSync } = require("zlib");
const { BROTLI_PARAM_QUALITY } = require("zlib").constants;

/**
 * Compresses a resource with the `brotli` algorithm.
 *
 * @param {any} data
 * @returns {Buffer}
 */
module.exports = function brotliData(data) {
    return brotliCompressSync(data, {
        params: {
            [BROTLI_PARAM_QUALITY]: 4
        }
    });
}