"use strict";

const { parentPort } = require("worker_threads");

const { compressData } = require("./compressionPool.cts");

if (parentPort) {
    parentPort.on("message", message => {
        const { gzipData, brotliData } = compressData(message);

        parentPort.postMessage({ gzipData, brotliData });
    });
}