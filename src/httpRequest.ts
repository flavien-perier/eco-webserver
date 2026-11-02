"use strict";

const http = require("http");
const https = require("https");

/**
 * Downloads a remote resource with explicit limits and error handling.
 * The timeout bounds the whole exchange, so a slowly trickling upstream cannot
 * hold a processing slot indefinitely.
 */
module.exports = function requestBuffer(url: URL, timeout: number, maxSize: number): Promise<{ buffer: Buffer; statusCode: number; headers: any }> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        let settled = false;
        const settle = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            callback();
        };
        const fail = (err: Error): void => settle(() => reject(err));

        const request = transport.get(url, response => {
            const chunks: Buffer[] = [];
            let size = 0;

            response.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxSize) {
                    fail(new Error(`Remote response exceeds ${maxSize} bytes`));
                    response.destroy();
                    request.destroy();
                } else {
                    chunks.push(chunk);
                }
            });
            response.on("error", fail);
            response.on("end", () => settle(() => resolve({
                buffer: Buffer.concat(chunks),
                statusCode: response.statusCode || 502,
                headers: response.headers,
            })));
        });

        const deadline = setTimeout(() => {
            const err: any = new Error(`Remote request timed out after ${timeout} ms`);
            err.statusCode = 504;
            fail(err);
            request.destroy();
        }, timeout);
        request.on("error", fail);
    });
};
