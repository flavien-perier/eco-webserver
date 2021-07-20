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
        const useGzip = (req.headers["accept-encoding"] || "").indexOf("gzip") != -1;

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
                const contentType = getContentType(req.url);
                content = await readProxy(req.url, useGzip);
                header = buildHeader(contentType, useGzip, content.hash);
            } else if (existsSync(fileUrl) && lstatSync(fileUrl).isFile()) {
                const contentType = getContentType(req.url);
                content = await readFile(req.url, req.url, contentType);
                header = buildHeader(contentType, useGzip, content.hash);
            } else if (configuration.use404File) {
                content = await readFile("404.html", req.url, configuration.contentType.html);
                statusCode = 404;
                statusMessage = "Not found";
                header = buildHeader(configuration.contentType.html, useGzip, content.hash);
            } else {
                content = await readFile("index.html", req.url, configuration.contentType.html);
                header = buildHeader(configuration.contentType.html, useGzip, content.hash);
            }

            // Test the hash of the request etag to know if the client's cash is still up to date.
            if (req.headers["if-none-match"] === content.hash) {
                res.writeHead(304, buildHeader(getContentType(req.url), false, null));
                res.write("");
            } else {
                res.writeHead(statusCode, statusMessage, header);
                res.write(useGzip ? content.gzipData : content.data);
            }

        } catch(err) {
            logger.error(`Internal server error: ${err.text}`, err);
            res.writeHead(500, "Internal server error", buildHeader(configuration.contentType.html, false, null));
            res.write("");
        }

        res.end();
    });
}
