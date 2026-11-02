"use strict";

const { parentPort } = require("worker_threads");

const { gzipSync, brotliCompressSync } = require("zlib");
const { GZIP_OPTIONS, BROTLI_OPTIONS } = require("./compressionOptions.ts");

/**
 * Returns an exact ArrayBuffer that can be transferred without cloning.
 */
function toTransferableBuffer(data: Buffer): ArrayBuffer {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

if (parentPort) {
    parentPort.on("message", message => {
        const result: { gzipData?: ArrayBuffer; brotliData?: ArrayBuffer } = {};
        const transferList: ArrayBuffer[] = [];

        if (!message.encoding || message.encoding === "gzip") {
            const gzipData = gzipSync(message.data, GZIP_OPTIONS);
            result.gzipData = toTransferableBuffer(gzipData);
            transferList.push(result.gzipData);
        }

        if (!message.encoding || message.encoding === "br") {
            const brotliData = brotliCompressSync(message.data, BROTLI_OPTIONS);
            result.brotliData = toTransferableBuffer(brotliData);
            transferList.push(result.brotliData);
        }

        parentPort.postMessage(result, transferList);
    });
}
