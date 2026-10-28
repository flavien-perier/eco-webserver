"use strict";

const http = require("http");

const { existsSync, lstatSync } = require("fs");
const { resolve, sep } = require("path");

const configuration = require("./configuration.cts").default;
const buildHeader = require("./buildHeader.cts");
const getContentType = require("./getContentType.cts");
const { readFile, readProxy } = require("./contentReader.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

/**
 * Returns the quality associated with an encoding in Accept-Encoding.
 *
 * @param {string} header
 * @param {string} encoding
 * @returns {number}
 */
function encodingQuality(header: string, encoding: string): number {
    let quality: number | null = null;
    let wildcardQuality: number | null = null;

    for (const part of header.split(",")) {
        const [name, ...parameters] = part.trim().toLowerCase().split(";");
        let currentQuality = 1;

        for (const parameter of parameters) {
            const match = /^\s*q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*$/.exec(parameter);
            if (match) currentQuality = Number(match[1]);
        }

        if (name === encoding) quality = currentQuality;
        else if (name === "*") wildcardQuality = currentQuality;
    }

    return quality ?? wildcardQuality ?? 0;
}

/**
 * Chooses the preferred supported response encoding.
 *
 * @param {string} header
 * @param {boolean} hasBrotli
 * @param {boolean} hasGzip
 * @returns {"br" | "gzip" | false}
 */
function negotiateEncoding(header: string, hasBrotli: boolean, hasGzip: boolean): "br" | "gzip" | false {
    const brotliQuality = hasBrotli ? encodingQuality(header, "br") : 0;
    const gzipQuality = hasGzip ? encodingQuality(header, "gzip") : 0;

    if (brotliQuality > 0 && brotliQuality >= gzipQuality) return "br";
    if (gzipQuality > 0) return "gzip";
    return false;
}

/**
 * Converts a request URL into a canonical path confined to distDir.
 *
 * @param {string} requestUrl
 * @returns {{requestPath: string, filePath: string}}
 */
function resolveRequestPath(requestUrl: string): { requestPath: string; filePath: string } {
    const parsedUrl = new URL(requestUrl || "/", "http://localhost");
    const requestPath = decodeURIComponent(parsedUrl.pathname);
    const distDir = resolve(configuration.distDir);
    const filePath = resolve(distDir, `.${requestPath}`);

    if (requestPath.includes("\0") || (filePath !== distDir && !filePath.startsWith(distDir + sep))) {
        throw new Error("Invalid request path");
    }

    return { requestPath, filePath };
}

/**
 * Eco-webserver
 *
 * @returns {http.Server}
 */
module.exports = (): http.Server => {
    return http.createServer(async (req, res) => {
        logger.http(req.headers["x-real-ip"] || req.connection.remoteAddress, req.headers["user-agent"], req.method, req.url);

        try {
            const requestUrl = req.url || "/";
            const { requestPath, filePath } = resolveRequestPath(requestUrl);
            const acceptEncoding = req.headers["accept-encoding"] || "";
            const proxyPrefix = Object.keys(configuration.proxy)
                .filter(url => requestPath.startsWith(url))
                .sort((a, b) => b.length - a.length)[0];

            let statusCode = 200;
            let statusMessage = "";
            let content: CacheValue;

            if (proxyPrefix) {
                content = await readProxy(requestUrl);
            } else if (existsSync(filePath) && lstatSync(filePath).isFile()) {
                const contentType = getContentType(requestPath);
                content = await readFile(requestPath, requestPath, contentType);
            } else if (configuration.use404File) {
                content = await readFile("404.html", requestPath, configuration.contentType.html);
                statusCode = 404;
                statusMessage = "Not found";
            } else {
                content = await readFile("index.html", requestPath, configuration.contentType.html);
            }

            const encoding = negotiateEncoding(acceptEncoding, !!content.brotliData, !!content.gzipData);
            const body = encoding === "br" ? content.brotliData : encoding === "gzip" ? content.gzipData : content.data;
            const header = buildHeader(content.contentType, encoding, content.hash);

            if (req.headers["if-none-match"] === content.hash) {
                res.writeHead(304, buildHeader(content.contentType, false, content.hash));
                res.end();
                return;
            }

            header["Content-Length"] = Buffer.byteLength(body);
            if (statusMessage) res.writeHead(statusCode, statusMessage, header);
            else res.writeHead(statusCode, header);
            res.end(req.method === "HEAD" ? undefined : body);
        } catch(err) {
            logger.error(`Internal server error: ${err.message || err}`, err);
            const header = buildHeader(configuration.contentType.html, false, null);
            header["Content-Length"] = 0;
            res.writeHead(500, "Internal server error", header);
            res.end();
        }
    });
};
