"use strict";

const http = require("http");
const https = require("https");

const { existsSync, readFileSync, lstatSync } = require("fs");
const { parse } = require("url");
const { join } = require("path");
const { gzipSync } = require("zlib");
const { createHash } = require("crypto");

const jsdom = require("jsdom");
const { Script } = require("vm");

const configuration = require("./configuration").default;
const minifyHtml = require("./minifyHtml");
const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");
const minifyJson = require("./minifyJson");
const Logger = require("./Logger");

const logger = new Logger();
const virtualConsole = new jsdom.VirtualConsole();

const TXT_CONETENT_TYPE = [configuration.contentType.html, configuration.contentType.css, configuration.contentType.js, configuration.contentType.json];
const MAX_TTL = 10;

/**
 * Associates a URL with its content in the cache.
 *
 * @type {Map<string, CacheValue>}
 */
const cache = new Map();

/**
 * Cleans at regular time intervals cache resources that have not been accessed for a long time.
 */
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

/**
 * Content of a cached resource.
 */
class CacheValue {
    constructor() {
        /**
         * @type {string | Buffer}
         */
        this.data;

        /**
         * @type {"txt" | "bin"}
         */
        this.dataType;

        /**
         * @type {number}
         */
        this.ttl;

        /**
         * @type {Buffer}
         */
        this.gzipData;

        /**
         * @type {String}
         */
        this.hash;
    }

    /**
     * Caching a local file.
     *
     * @param {string} filePath
     * @param {string} requestUrl
     * @param {string} contentType
     * @returns {Promise<void>}
     */
    async localFile(filePath, requestUrl, contentType) {
        if (TXT_CONETENT_TYPE.indexOf(contentType) != -1) {
            this.data = readFileSync(join(configuration.distDir, filePath), "utf8");
            this.dataType = "txt";
        } else {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
        }

        if (contentType == configuration.contentType.html && configuration.enableIsomorphic)
            this.data = await evaluateHtmlFile(this.data, requestUrl);

        this.hash = createHash("sha256").update(this.data || "").digest("hex");

        switch(contentType) {
            case configuration.contentType.html:
                this.data = await minifyHtml(this.data, this.hash);
                break;
            case configuration.contentType.css:
                this.data = minifyCss(this.data, this.hash);
                break;
            case configuration.contentType.js:
                this.data = await minifyJs(this.data, this.hash);
                break;
            case configuration.contentType.json:
                this.data = minifyJson(this.data, this.hash);
                break;
        }

        this.ttl = 0;
        this.gzipData = gzipData(this.data);
    }

    /**
     * Caching a remote file.
     *
     * @param {string} requestUrl
     * @returns {Promise<void>}
     */
    proxyFile(requestUrl) {
        return new Promise((resolve, reject) => {
            const requestBaseUrl = Object.keys(configuration.proxy).filter(key => key === requestUrl.substr(0, key.length))[0];
            const proxyBaseUrl = configuration.proxy[requestBaseUrl];

            const proxyUrl = `${proxyBaseUrl}${requestUrl.substr(requestBaseUrl.length)}`;
            const options = parse(proxyUrl);

            let buffer = Buffer.alloc(0);
            (options.protocol == "https:" ? https : http).get(options, res => {
                res.on("data", data => {
                    buffer = Buffer.concat([buffer, data]);
                }).on("end", () => {
                    this.data = buffer;
                    this.gzipData = gzipData(this.data);
                    this.hash = createHash("sha256").update(this.data || "").digest("hex");
                    resolve();
                });
            });

            this.dataType = "bin";
            this.ttl = 0;
        });
    }
}

/**
 * Function allowing to make a pre-rendering of the java script on the backend side.
 *
 * @param {string | Buffer} content
 * @param {string} requestUrl
 * @returns {Promise<string>}
 */
function evaluateHtmlFile(content, requestUrl) {
    return new Promise((resolve, reject) => {
        // Declares a virtual DOM.
        const dom = new jsdom.JSDOM(content, {
            url: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            referrer: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            contentType: "text/html",
            userAgent: "internal-eco-webserver",
            virtualConsole: virtualConsole,
            strictSSL: false,
            includeNodeLocations: true,
            runScripts: "outside-only"
        });

        const vmContext = dom.getInternalVMContext();

        /**
         * Function to execute a script in the virtual DOM.
         *
         * @param {Script} script
         */
        const executeScript = (script) => {
            try {
                script.runInContext(vmContext);
            } catch(err) {
                logger.error("Error with script execution", err);
            }
        }

        // Finds the source of each script and sends it to the `executeScript` function.
        [...dom.window.document.getElementsByTagName("script").valueOf()]
            .forEach(async script => {
                if (script.attributes && script.attributes.src && script.attributes.src.value) {
                    const scriptSrc = script.attributes.src.value;

                    if (/^http[s]?:\/\//.test(scriptSrc)) {
                        let buffer = Buffer.alloc(0);
                        (scriptSrc.split(":")[0] == "https" ? https : http).get(parse(scriptSrc), res => {
                            res.on("data", data => {
                                buffer = Buffer.concat([buffer, data]);
                            }).on("end", () => {
                                executeScript(new Script(buffer.toString()));
                            });
                        });
                    } else {
                        const cacheValue = await readFile(scriptSrc, scriptSrc, configuration.contentType.js);
                        executeScript(new Script(cacheValue.data));
                    }
                } else {
                    executeScript(new Script(script.innerHTML));
                }
            });

        // Checks if the dom is still being modified. If not, displays its current status.

        let increment = 0;
        let lastComputedHtmlMd5 = "";

        const loop = setInterval(() => {
            const computedHtml = dom.serialize();
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

/**
 * Gives the "content-type" of a resource according to its extension.
 *
 * @param {string} filePath
 * @returns {string}
 */
function getContentType(filePath) {
    const parsing = /\.([a-zA-Z0-9]+)$/.exec(filePath);

    if (!parsing) {
        return configuration.contentType.html;
    }

    const extension = parsing[1];

    if (extension && configuration.contentType[extension]) {
        return configuration.contentType[extension];
    } else {
        return configuration.contentType.text;
    }
}

/**
 * Builds the response header.
 *
 * @param {string} contentType
 * @param {boolean} useGzip
 * @param {string} etag
 * @returns {{[string]: string}}
 */
function buildHeader(contentType, useGzip, etag) {
    const header = {
        ...configuration.header,
        "Content-Type": contentType,
    };

    if (useGzip) {
        header["Content-Encoding"] = "gzip";
    }

    if (etag) {
        header["ETag"] = etag;
    }

    return header;
}

/**
 * Reads the contents of a resource from the `dist` folder.
 *
 * @param {string} filePath
 * @param {string} requestUrl
 * @param {string} contentType
 * @returns {Promise<CacheValue>}
 */
async function readFile(filePath, requestUrl, contentType) {
    /**
     * @type {CacheValue}
     */
    let cacheValue;

    if (cache.has(requestUrl)) {
        cacheValue = cache.get(requestUrl);
        cacheValue.ttl++;
    } else {
        cacheValue = new CacheValue();
        await cacheValue.localFile(filePath, requestUrl, contentType);
        cache.set(requestUrl, cacheValue);
    }

    return cacheValue;
}

/**
 * Retrieves the content of a remote resource.
 *
 * @param {string} requestUrl
 * @returns {Promise<CacheValue>}
 */
async function readProxy(requestUrl) {
    /**
     * @type {CacheValue}
     */
    let cacheValue;

    if (cache.has(requestUrl)) {
        cacheValue = cache.get(requestUrl);
        cacheValue.ttl++;
    } else {
        cacheValue = new CacheValue();
        await cacheValue.proxyFile(requestUrl);
        cache.set(requestUrl, cacheValue);
    }

    return cacheValue;
}

/**
 * Compresses a resource with the `gzip` algorithm.
 *
 * @param {any} data
 * @returns {Buffer}
 */
function gzipData(data) {
    return gzipSync(data, {
        level: 4
    });
}

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
