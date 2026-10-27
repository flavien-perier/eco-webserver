"use strict";

const http = require("http");

const { existsSync, lstatSync } = require("fs");
const { join } = require("path");

const configuration = require("./configuration").default;
const buildHeader = require("./buildHeader");
const getContentType = require("./getContentType");
const { readFile, readProxy } = require("./contentReader");
const Logger = require("./Logger");

const logger = new Logger();

/**
 * Eco-webserver
 *
 * @returns {http.Server}
 */
module.exports = () => {
    return http.createServer(async (req, res) => {
        logger.http(req.headers["x-real-ip"] || req.connection.remoteAddress, req.headers["user-agent"], req.method, req.url);

        const fileUrl = join(configuration.distDir, req.url);
        const acceptEncoding = req.headers["accept-encoding"] || "";
        const useBrotli = acceptEncoding.indexOf("br") != -1;
        const useGzip = acceptEncoding.indexOf("gzip") != -1;

        try {
            /**
             * @type {number}
             */
            let statusCode = 200;

            /**
             * @type {string}
             */
            let statusMessage = "";

            /**
             * @type {Object}
             */
            let header;

            /**
             * @type {CacheValue}
             */
            let content;

            if (Object.keys(configuration.proxy).some(url => url === req.url.substr(0, url.length))) {
                content = await readProxy(req.url);
            } else if (existsSync(fileUrl) && lstatSync(fileUrl).isFile()) {
                const contentType = getContentType(req.url);
                content = await readFile(req.url, req.url, contentType);
            } else if (configuration.use404File) {
                content = await readFile("404.html", req.url, configuration.contentType.html);
                statusCode = 404;
                statusMessage = "Not found";
            } else {
                content = await readFile("index.html", req.url, configuration.contentType.html);
            }

            // Chooses the best compression accepted by the client.
            const encoding = useBrotli && content.brotliData ? "br" : useGzip && content.gzipData ? "gzip" : false;
            header = buildHeader(content.contentType, encoding, content.hash);

            // Test the hash of the request etag to know if the client's cash is still up to date.
            if (req.headers["if-none-match"] === content.hash) {
                res.writeHead(304, buildHeader(content.contentType, false, null));
                res.write("");
            } else {
                res.writeHead(statusCode, statusMessage, header);
                res.write(encoding === "br" ? content.brotliData : encoding === "gzip" ? content.gzipData : content.data);
            }

        } catch(err) {
            logger.error(`Internal server error: ${err.text}`, err);
            res.writeHead(500, "Internal server error", buildHeader(configuration.contentType.html, false, null));
            res.write("");
        }

        res.end();
    });
}
