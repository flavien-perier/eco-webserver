"use strict";

const http = require("http");
const https = require("https");

const { existsSync, readFileSync, lstatSync } = require("fs");
const { parse } = require("url");
const { join } = require("path");
const { gzipSync } = require("zlib");
const { createHash } = require("crypto");
const { JSDOM } = require("jsdom");

const configuration = require("./configuration").default;

const TXT_CONETENT_TYPE = [configuration.contentType.css, configuration.contentType.js, configuration.contentType.json];
const MAX_TTL = 10;

const cache = new Map();

setInterval(() => {
    cache.forEach((value, key, cache) => {
        if (value.ttl <= 0) {
            cache.delete(key);
        } else if (value.ttl > MAX_TTL) {
            value.ttl = MAX_TTL;
        } else {
            value.ttl--;
        }
    });
}, configuration.cacheCycle * 1000);

class CacheValue {
    async localFile(filePath, requestUrl, fileContentType) {
        if (fileContentType == configuration.contentType.html && configuration.enableIsomorphic) {
            this.data = await evaluateHtmlFile(readFileSync(join(configuration.distDir, filePath), "utf8"), requestUrl);
            this.dataType = "txt";
        } else if (TXT_CONETENT_TYPE.indexOf(fileContentType) != -1) {
            this.data = readFileSync(join(configuration.distDir, filePath), "utf8");
            this.dataType = "txt";
        } else {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
        }

        this.ttl = 0;
        this.gzipData = gzipData(this.data);
    }

    proxyFile(requestUrl) {
        return new Promise((resolve, reject) => {
            const cdnUrl = configuration.proxy[requestUrl];

            const options = parse(cdnUrl);

            let buffer = Buffer.alloc(0);
            (options.protocol == "https:" ? https : http).get(options, res => {
                res.on("data", data => {
                    buffer = Buffer.concat([buffer, data]);
                }).on("end", () => {
                    this.data = buffer;
                    this.gzipData = gzipData(this.data);
                    resolve();
                });
            });

            this.dataType = "bin";
            this.ttl = 0;
        });
    }
}

function evaluateHtmlFile(fileContent, requestUrl) {
    return new Promise((resolve, reject) => {
        const dom = new JSDOM(fileContent, {
            url: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            referrer: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            contentType: "text/html",
            userAgent: "internal-eco-webserver",
            strictSSL: false,
            includeNodeLocations: true,
            runScripts: "dangerously"
        });

        [...dom.window.document.getElementsByTagName("script").valueOf()]
            .forEach(async script => {
                if (script.attributes && script.attributes.src && script.attributes.src.value) {
                    const contentFile = await readFile(script.attributes.src.value, script.attributes.src.value, configuration.contentType.js, false);
                    dom.window.eval(contentFile);
                }
            });

        let increment = 0;
        let lastComputedHtmlMd5 = "";

        const loop = setInterval(() => {
            const computedHtml = dom.window.document.documentElement.outerHTML;
            const computedHtmlMd5 = createHash("md5").update(computedHtml).digest("hex");

            if (lastComputedHtmlMd5 === computedHtmlMd5 || increment++ > 20) {
                dom.window.stop();
                resolve(computedHtml);
                clearInterval(loop);
            } else {
                lastComputedHtmlMd5 = computedHtmlMd5;
            }
        }, 100);
    });
}

function getContentType(filePath) {
    const parsing = /\.([a-zA-Z0-9]+)$/.exec(filePath);

    if (!parsing) {
        return null;
    }

    const extension = parsing[1];

    if (extension && configuration.contentType[extension]) {
        return configuration.contentType[extension];
    } else {
        return configuration.contentType.text;
    }
}

function buildHeader(contentType, useGzip) {
    const header = {
        "Content-Type": contentType,
        ...configuration.header
    };

    if (useGzip) {
        header["Content-Encoding"] = "gzip";
    }

    return header;
}

async function readFile(filePath, requestUrl, fileContentType, useGzip) {
    let cacheValue;
    if (cache.has(requestUrl)) {
        cacheValue = cache.get(requestUrl);
        cacheValue.ttl++;
    } else {
        cacheValue = new CacheValue();
        await cacheValue.localFile(filePath, requestUrl, fileContentType);
        cache.set(requestUrl, cacheValue);
    }

    return useGzip ? cacheValue.gzipData : cacheValue.data;
}

async function readProxy(requestUrl, useGzip) {
    let cacheValue;
    if (cache.has(requestUrl)) {
        cacheValue = cache.get(requestUrl);
        cacheValue.ttl++;
    } else {
        cacheValue = new CacheValue();
        await cacheValue.proxyFile(requestUrl);
        cache.set(requestUrl, cacheValue);
    }

    return useGzip ? cacheValue.gzipData : cacheValue.data;
}

function gzipData(data) {
    return gzipSync(data, {
        level: 4
    });
}

module.exports = () => {
    return http.createServer(async (req, res) => {
        console.info(`[${new Date().toISOString()}] [${req.headers["x-real-ip"] || req.connection.remoteAddress}] [${req.headers["user-agent"]}] - ${req.method}: ${req.url}`);

        const fileUrl = join(configuration.distDir, req.url);
        const useGzip = (req.headers["accept-encoding"] || "").indexOf("gzip") != -1;

        try {
            if (Object.keys(configuration.proxy).indexOf(req.url) != -1) {
                const contentType = getContentType(req.url);
                res.writeHead(200, buildHeader(contentType, useGzip));
                res.write(await readProxy(req.url, useGzip));
            } else if (existsSync(fileUrl) && lstatSync(fileUrl).isFile()) {
                const contentType = getContentType(req.url);
                res.writeHead(200, buildHeader(contentType, useGzip));
                res.write(await readFile(req.url, req.url, contentType, useGzip));
            } else if (configuration.use404File) {
                res.writeHead(404, "Not found", buildHeader(configuration.contentType.html, useGzip));
                res.write(await readFile("404.html", req.url, configuration.contentType.html, useGzip));
            } else {
                res.writeHead(200, buildHeader(configuration.contentType.html, useGzip));
                res.write(await readFile("index.html", req.url, configuration.contentType.html, useGzip));
            }
        } catch(err) {
            console.error(`[${new Date().toISOString()}] Internal server error: ${err.text}`);
            res.writeHead(500, "Internal server error", buildHeader(configuration.contentType.html, useGzip));
            if (configuration.use500File) {
                res.write(await readFile("500.html", req.url, configuration.contentType.html, useGzip));
            }
        }

        res.end();
    });
}
