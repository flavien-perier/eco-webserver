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
const getContentType = require("./getContentType");
const minifyHtml = require("./minifyHtml");
const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");
const minifyJson = require("./minifyJson");
const minifySvg = require("./minifySvg");
const minifyXml = require("./minifyXml");
const convertImage = require("./convertImage");
const convertFont = require("./convertFont");
const renderChromium = require("./renderChromium");
const gzipData = require("./gzipData");
const brotliData = require("./brotliData");
const Logger = require("./Logger");

const logger = new Logger();

const virtualConsole = new jsdom.VirtualConsole();

const TXT_CONETENT_TYPE = [
    configuration.contentType.html,
    configuration.contentType.css,
    configuration.contentType.js,
    configuration.contentType.json,
    configuration.contentType.svg,
    configuration.contentType.xml
];
const WEBP_CONVERSION_CONTENT_TYPE = [
    configuration.contentType.png,
    configuration.contentType.jpg,
    configuration.contentType.jpeg,
    configuration.contentType.gif,
    configuration.contentType.tif,
    configuration.contentType.tiff
];
const WOFF2_CONVERSION_CONTENT_TYPE = [
    configuration.contentType.ttf,
    configuration.contentType.otf
];
const CONVERTIBLE_CONTENT_TYPE = [...WEBP_CONVERSION_CONTENT_TYPE, ...WOFF2_CONVERSION_CONTENT_TYPE];
const MAX_TTL = 10;

/**
 * Calculates the sha256 sum of a resource.
 *
 * @param {string | Buffer} data
 * @returns {string}
 */
const sha256Hex = data => createHash("sha256").update(data || "").digest("hex");

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
         * @type {Buffer}
         */
        this.brotliData;

        /**
         * @type {string}
         */
        this.contentType;

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
        this.contentType = contentType;

        if (CONVERTIBLE_CONTENT_TYPE.indexOf(contentType) !== -1) {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
            const converted = await convertResource(this.data, contentType);
            this.data = converted.data;
            this.contentType = converted.contentType;
            this.hash = sha256Hex(this.data);
        } else if (TXT_CONETENT_TYPE.indexOf(contentType) !== -1) {
            this.data = readFileSync(join(configuration.distDir, filePath), "utf8");
            this.dataType = "txt";

            if (contentType === configuration.contentType.html && configuration.enableIsomorphic)
                this.data = await renderChromium(this.data, requestUrl) || await evaluateHtmlFile(this.data, requestUrl);

            this.hash = sha256Hex(this.data);

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
                case configuration.contentType.svg:
                    this.data = minifySvg(this.data, this.hash);
                    break;
                case configuration.contentType.xml:
                    this.data = minifyXml(this.data, this.hash);
                    break;
            }

            // Compresses only the text formats.
            this.gzipData = gzipData(this.data);
            this.brotliData = brotliData(this.data);
        } else {
            this.data = readFileSync(join(configuration.distDir, filePath));
            this.dataType = "bin";
            this.hash = sha256Hex(this.data);
        }

        this.ttl = 0;
    }

    /**
     * Caching a remote file.
     *
     * @param {string} requestUrl
     * @returns {Promise<void>}
     */
    async proxyFile(requestUrl) {
        const buffer = await new Promise((resolve, reject) => {
            const requestBaseUrl = Object.keys(configuration.proxy).filter(key => key === requestUrl.substr(0, key.length))[0];
            const proxyBaseUrl = configuration.proxy[requestBaseUrl];

            const proxyUrl = `${proxyBaseUrl}${requestUrl.substr(requestBaseUrl.length)}`;
            const options = parse(proxyUrl);

            let dataBuffer = Buffer.alloc(0);
            (options.protocol === "https:" ? https : http).get(options, res => {
                res.on("data", data => {
                    dataBuffer = Buffer.concat([dataBuffer, data]);
                }).on("end", () => {
                    resolve(dataBuffer);
                });
            });
        });

        const contentType = getContentType(requestUrl);

        if (TXT_CONETENT_TYPE.indexOf(contentType) !== -1) {
            this.data = buffer.toString("utf8");
            this.dataType = "txt";
            this.contentType = contentType;
            this.gzipData = gzipData(this.data);
            this.brotliData = brotliData(this.data);
        } else {
            this.dataType = "bin";
            const converted = await convertResource(buffer, contentType);
            this.data = converted.data;
            this.contentType = converted.contentType;
        }

        this.hash = sha256Hex(this.data);
        this.ttl = 0;
    }
}

/**
 * Converts a binary resource if its type allows it.
 *
 * @param {Buffer} data
 * @param {string} contentType
 * @returns {Promise<{data: Buffer, contentType: string}>}
 */
async function convertResource(data, contentType) {
    if (WEBP_CONVERSION_CONTENT_TYPE.indexOf(contentType) !== -1) {
        const webpData = await convertImage(data, sha256Hex(data));

        if (webpData) {
            return { data: webpData, contentType: configuration.contentType.webp };
        }
    } else if (WOFF2_CONVERSION_CONTENT_TYPE.indexOf(contentType) !== -1) {
        const woff2Data = await convertFont(data, sha256Hex(data));

        if (woff2Data) {
            return { data: woff2Data, contentType: configuration.contentType.woff2 };
        }
    }

    return { data, contentType };
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