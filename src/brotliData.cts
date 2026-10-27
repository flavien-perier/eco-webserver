"use strict";

const { brotliCompressSync, constants } = require("zlib");

/**
 * Compresses a resource with the `brotli` algorithm.
 *
 * @param {any} data
 * @returns {Buffer}
 */
module.exports = function brotliData(data: any): Buffer {
    return brotliCompressSync(data, {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: 4
        }
    });
}