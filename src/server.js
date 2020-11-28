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
    /**
     * Caching a local file.
     *
     * @param {string} filePath
     * @param {string} requestUrl
     * @param {string} fileContentType
     * @returns {Promise<void>}
     */
    async localFile(filePath, requestUrl, fileContentType) {
        if (TXT_CONETENT_TYPE.indexOf(fileContentType) != -1) {
            this.data = readFileSync(join(configuration.distDir, filePath), "utf8");
            this.dataType = "txt";
        } else {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
        }

        if (fileContentType == configuration.contentType.html && configuration.enableIsomorphic)
            this.data = await evaluateHtmlFile(this.data, requestUrl);

        switch(fileContentType) {
            case configuration.contentType.html:
                this.data = minifyHtml(this.data);
                break;
            case configuration.contentType.css:
                this.data = minifyCss(this.data);
                break;
            case configuration.contentType.js:
                this.data = minifyJs(this.data);
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
 * @param {any} fileContent
 * @param {string} requestUrl
 * @returns {Promise<any>}
 */
function evaluateHtmlFile(fileContent, requestUrl) {
    return new Promise((resolve, reject) => {
        // Declares a virtual DOM.
        const dom = new jsdom.JSDOM(fileContent, {
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
                        executeScript(new Script(await readFile(scriptSrc, scriptSrc, configuration.contentType.js, false)));
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
 * @returns {any}
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
 * @returns {any}
 */
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

/**
 * Reads the contents of a resource from the `dist` folder.
 *
 * @param {string} filePath
 * @param {string} requestUrl
 * @param {string} fileContentType
 * @param {boolean} useGzip
 * @returns {Promise<any>}
 */
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

/**
 * Retrieves the content of a remote resource.
 *
 * @param {string} requestUrl
 * @param {boolean} useGzip
 * @returns {Promise<any>}
 */
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
            if (Object.keys(configuration.proxy).some(url => url === req.url.substr(0, url.length))) {
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
            logger.error(`Internal server error: ${err.text}`, err);
            res.writeHead(500, "Internal server error", buildHeader(configuration.contentType.html, useGzip));
            if (configuration.use500File) {
                res.write(await readFile("500.html", req.url, configuration.contentType.html, useGzip));
            }
        }

        res.end();
    });
}
