"use strict";

const http = require("http");
const https = require("https");

const { readFileSync } = require("fs");
const { parse } = require("url");
const { join } = require("path");
const { createHash } = require("crypto");

const jsdom = require("jsdom");
const { Script } = require("vm");

const configuration = require("./configuration").default;
const minifyHtml = require("./minifyHtml");
const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");
const minifyJson = require("./minifyJson");
const gzipData = require("./gzipData");
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
        if (TXT_CONETENT_TYPE.indexOf(contentType) !== -1) {
            this.data = readFileSync(join(configuration.distDir, filePath), "utf8");
            this.dataType = "txt";
        } else {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
        }

        if (contentType === configuration.contentType.html && configuration.enableIsomorphic)
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
            (options.protocol === "https:" ? https : http).get(options, res => {
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
            virtualConsole,
            includeNodeLocations: true,
            runScripts: "outside-only",
            resources: new jsdom.ResourceLoader({
                userAgent: "internal-eco-webserver",
                strictSSL: false,
            }),
        });

        const vmContext = dom.getInternalVMContext();

        /**
         * Function to execute a script in the virtual DOM.
         *
         * @param {string} scriptTxt
         */
        const executeScript = (scriptTxt) => {
            try {
                new Script(scriptTxt).runInContext(vmContext);
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
                        (scriptSrc.split(":")[0] === "https" ? https : http).get(parse(scriptSrc), res => {
                            res.on("data", data => {
                                buffer = Buffer.concat([buffer, data]);
                            }).on("end", () => {
                                executeScript(buffer.toString());
                            });
                        });
                    } else {
                        const cacheValue = await readFile(scriptSrc, scriptSrc, configuration.contentType.js);
                        executeScript(cacheValue.data);
                    }
                } else {
                    executeScript(script.innerHTML);
                }
            });

        // Checks if the dom is still being modified. If not, displays its current status.

        let increment = 0;
        let lastComputedHtmlMd5 = "";

        const loop = setInterval(() => {
            const computedHtml = dom.serialize();
            const computedHtmlMd5 = createHash("md5").update(computedHtml).digest("hex");

            if (lastComputedHtmlMd5 === computedHtmlMd5 || increment++ > 20) {
                vmContext.close();
                resolve(computedHtml);
                clearInterval(loop);
            } else {
                lastComputedHtmlMd5 = computedHtmlMd5;
            }
        }, 100);
    });
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

module.exports = {
    readFile,
    readProxy,
};