"use strict";

const http = require("http");
const https = require("https");

/**
 * Downloads a remote resource with explicit limits and error handling.
 *
 * @param {URL} url
 * @param {number} timeout
 * @param {number} maxSize
 * @returns {Promise<{buffer: Buffer, statusCode: number, headers: Object}>}
 */
module.exports = function requestBuffer(url: URL, timeout: number, maxSize: number): Promise<{ buffer: Buffer; statusCode: number; headers: any }> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const request = transport.get(url, response => {
            const chunks: Buffer[] = [];
            let size = 0;

            response.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxSize) {
                    reject(new Error(`Remote response exceeds ${maxSize} bytes`));
                    response.destroy();
                    request.destroy();
                } else {
                    chunks.push(chunk);
                }
            });
            response.on("error", reject);
            response.on("end", () => {
                resolve({
                    buffer: Buffer.concat(chunks),
                    statusCode: response.statusCode || 502,
                    headers: response.headers,
                });
            });
        });

        request.setTimeout(timeout, () => {
            reject(new Error(`Remote request timed out after ${timeout} ms`));
            request.destroy();
        });
        request.on("error", reject);
    });
};
