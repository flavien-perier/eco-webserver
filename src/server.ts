"use strict";

const http = require("http");

const { lstat } = require("fs/promises");
const { resolve, sep } = require("path");

const configuration = require("./configuration.ts").default;
const buildHeader = require("./buildHeader.ts");
const getContentType = require("./getContentType.ts");
const { readFile, readProxy } = require("./contentReader.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();
const PROXY_PREFIXES = Object.keys(configuration.proxy).sort((a, b) => b.length - a.length);
const PATH_CACHE_VALIDATION_INTERVAL = Math.max(1, Number(configuration.cacheValidationInterval) || 60 * 1000);
const PATH_CACHE_MAX_ENTRIES = Math.max(1, Number(configuration.cacheMaxEntries) || 1000);
const pathCache = new Map<string, { isFile: boolean; lastValidated: number }>();

/**
 * Converts a request URL into a canonical path confined to distDir.
 */
function resolveRequestPath(requestUrl: string): { requestPath: string; filePath: string } {
    try {
        const parsedUrl = new URL(requestUrl || "/", "http://localhost");
        const requestPath = decodeURIComponent(parsedUrl.pathname);
        const distDir = resolve(configuration.distDir);
        const filePath = resolve(distDir, `.${requestPath}`);

        if (requestPath.includes("\0") || (filePath !== distDir && !filePath.startsWith(distDir + sep))) {
            throw new Error("Invalid request path");
        }

        return { requestPath, filePath };
    } catch(err) {
        const error: any = new Error("Invalid request path");
        error.statusCode = 400;
        throw error;
    }
}

/**
 * Checks whether a path is a regular file without following symbolic links.
 * Positive and negative resolutions share the content revalidation interval.
 */
async function isFile(filePath: string): Promise<boolean> {
    const cached = pathCache.get(filePath);
    if (cached && Date.now() - cached.lastValidated < PATH_CACHE_VALIDATION_INTERVAL) {
        pathCache.delete(filePath);
        pathCache.set(filePath, cached);
        return cached.isFile;
    }

    let result = false;
    try {
        result = (await lstat(filePath)).isFile();
    } catch(err) {
        if (err.code !== "ENOENT") throw err;
    }

    pathCache.delete(filePath);
    pathCache.set(filePath, { isFile: result, lastValidated: Date.now() });
    while (pathCache.size > PATH_CACHE_MAX_ENTRIES) {
        pathCache.delete(pathCache.keys().next().value);
    }
    return result;
}

/**
 * Eco-webserver
 */
module.exports = (): http.Server => {
    return http.createServer(async (req, res) => {
        if (configuration.accessLog !== false) {
            logger.http(req.headers["x-real-ip"] || req.connection.remoteAddress, req.headers["user-agent"], req.method, req.url);
        }

        if (req.method !== "GET" && req.method !== "HEAD") {
            const header = buildHeader(configuration.contentType.html, false, null);
            header["Content-Length"] = 0;
            header["Allow"] = "GET, HEAD";
            res.writeHead(405, "Method Not Allowed", header);
            res.end();
            return;
        }

        try {
            const requestUrl = req.url || "/";
            const { requestPath, filePath } = resolveRequestPath(requestUrl);
            const acceptEncoding = typeof req.headers["accept-encoding"] === "string" ? req.headers["accept-encoding"] : "";
            const proxyPrefix = PROXY_PREFIXES.find(url => requestPath.startsWith(url));

            let statusCode = 200;
            let statusMessage = "";
            let content: CacheValue;

            if (proxyPrefix) {
                content = await readProxy(requestUrl, acceptEncoding);
                statusCode = content.statusCode;
            } else if (await isFile(filePath)) {
                const contentType = getContentType(requestPath);
                content = await readFile(requestPath, requestPath, contentType, acceptEncoding);
            } else if (configuration.use404File) {
                content = await readFile("404.html", requestPath, configuration.contentType.html, acceptEncoding);
                statusCode = 404;
                statusMessage = "Not found";
            } else {
                content = await readFile("index.html", requestPath, configuration.contentType.html, acceptEncoding);
            }

            if (req.headers["if-none-match"] === content.hash) {
                res.writeHead(304, buildHeader(content.contentType, false, content.hash));
                res.end();
                return;
            }

            const { encoding, body } = await content.responseData(acceptEncoding);
            const header = buildHeader(content.contentType, encoding, content.hash);
            header["Content-Length"] = Buffer.isBuffer(body) ? body.length : content.dataLength;
            if (statusMessage) res.writeHead(statusCode, statusMessage, header);
            else res.writeHead(statusCode, header);
            res.end(req.method === "HEAD" ? undefined : body);
        } catch(err) {
            logger.error(`Internal server error: ${err.message || err}`, err);
            const statusCode = [400, 503, 504].includes(err.statusCode) ? err.statusCode : 500;
            const statusMessage = statusCode === 400 ? "Bad Request" : statusCode === 503 ? "Service Unavailable" : statusCode === 504 ? "Gateway Timeout" : "Internal server error";
            const header = buildHeader(configuration.contentType.html, false, null);
            header["Content-Length"] = 0;
            if (statusCode === 503) header["Retry-After"] = "1";
            res.writeHead(statusCode, statusMessage, header);
            res.end();
        }
    });
};
