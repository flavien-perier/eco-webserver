"use strict";

const { parentPort } = require("worker_threads");

const { gzipSync, brotliCompressSync, constants } = require("zlib");

if (parentPort) {
    parentPort.on("message", message => {
        const gzipData = gzipSync(message, { level: 4 });
        const brotliData = brotliCompressSync(message, {
            params: {
                [constants.BROTLI_PARAM_QUALITY]: 4
            }
        });

        parentPort.postMessage({ gzipData, brotliData });
    });
}