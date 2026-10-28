"use strict";

const http = require("http");
const https = require("https");

const { readFile: readFileFromDisk, stat } = require("fs/promises");
const { parse } = require("url");
const { resolve, sep } = require("path");
const { createHash } = require("crypto");

const jsdom = require("jsdom");
const { Script } = require("vm");

const configuration = require("./configuration.cts").default;
const getContentType = require("./getContentType.cts");
const minifyHtml = require("./minifyHtml.cts");
const minifyCss = require("./minifyCss.cts");
const minifyJs = require("./minifyJs.cts");
const minifyJson = require("./minifyJson.cts");
const minifySvg = require("./minifySvg.cts");
const minifyXml = require("./minifyXml.cts");
const convertImage = require("./convertImage.cts");
const convertFont = require("./convertFont.cts");
const renderChromium = require("./renderChromium.cts");
const { CompressionPool } = require("./compressionPool.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

const virtualConsole = new jsdom.VirtualConsole();

/**
 * Number of workers compressing the text resources outside of the event loop.
 */
const COMPRESSION_POOL_SIZE = Math.max(1, Number(process.env.ECO_COMPRESSION_POOL_SIZE) || 4);

/**
 * Compresses the text resources with `gzip` and `brotli` inside workers.
 */
const compressionPool = new CompressionPool(COMPRESSION_POOL_SIZE);

const TXT_CONETENT_TYPE: string[] = [
    configuration.contentType.html,
    configuration.contentType.css,
    configuration.contentType.js,
    configuration.contentType.json,
    configuration.contentType.svg,
    configuration.contentType.xml
];
const WEBP_CONVERSION_CONTENT_TYPE: string[] = [
    configuration.contentType.png,
    configuration.contentType.jpg,
    configuration.contentType.jpeg,
    configuration.contentType.gif,
    configuration.contentType.tif,
    configuration.contentType.tiff
];
const WOFF2_CONVERSION_CONTENT_TYPE: string[] = [
    configuration.contentType.ttf,
    configuration.contentType.otf
];
const CONVERTIBLE_CONTENT_TYPE: string[] = [...WEBP_CONVERSION_CONTENT_TYPE, ...WOFF2_CONVERSION_CONTENT_TYPE];
const MAX_TTL = 10;
const CACHE_MAX_ENTRIES = Math.max(1, Number(process.env.ECO_CACHE_MAX_ENTRIES || configuration.cacheMaxEntries) || 1000);
const CACHE_MAX_SIZE = Math.max(1, Number(process.env.ECO_CACHE_MAX_SIZE || configuration.cacheMaxSize) || 100 * 1024 * 1024);
const CACHE_VALIDATION_INTERVAL = Math.max(1, Number(configuration.cacheValidationInterval) || 60 * 1000);

/**
 * Calculates the sha256 sum of a resource.
 *
 * @param {string | Buffer} data
 * @returns {string}
 */
const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data || "").digest("hex");

/**
 * Resolves a local resource without allowing it to escape distDir.
 *
 * @param {string} filePath
 * @returns {string}
 */
function resolveLocalPath(filePath: string): string {
    const distDir = resolve(configuration.distDir);
    const localPath = resolve(distDir, `.${filePath.startsWith("/") ? filePath : `/${filePath}`}`);
    if (localPath !== distDir && !localPath.startsWith(distDir + sep)) throw new Error("Invalid resource path");
    return localPath;
}

/**
 * Associates a URL with its content in the cache.
 *
 * @type {Map<string, CacheValue>}
 */
const cache = new Map<string, CacheValue>();
let cacheSize = 0;

/**
 * Removes a resource and updates the tracked cache size.
 *
 * @param {string} key
 * @returns {void}
 */
function removeCachedResource(key: string): void {
    const value = cache.get(key);
    if (!value) return;
    cache.delete(key);
    cacheSize -= value.size;
}

/**
 * Marks a cached resource as recently used.
 *
 * @param {string} key
 * @param {CacheValue} value
 * @returns {void}
 */
function touchCachedResource(key: string, value: CacheValue): void {
    cache.delete(key);
    cache.set(key, value);
}

/**
 * Stores a resource and evicts the least recently used entries above the limits.
 *
 * @param {string} key
 * @param {CacheValue} value
 * @returns {void}
 */
function storeCachedResource(key: string, value: CacheValue): void {
    if (value.size > CACHE_MAX_SIZE) return;
    removeCachedResource(key);
    cache.set(key, value);
    cacheSize += value.size;

    while (cache.size > CACHE_MAX_ENTRIES || cacheSize > CACHE_MAX_SIZE) {
        removeCachedResource(cache.keys().next().value);
    }
}

/**
 * Resource loads currently in progress, shared by concurrent requests.
 *
 * @type {Map<string, Promise<CacheValue>>}
 */
const pendingResources = new Map<string, Promise<CacheValue>>();

/**
 * Cleans at regular time intervals cache resources that have not been accessed for a long time.
 */
setInterval((): void => {
    cache.forEach((value: CacheValue, key: string) => {
        if (value.ttl <= 0) {
            removeCachedResource(key);
        } else if (value.ttl > MAX_TTL) {
            value.ttl = MAX_TTL;
        } else {
            value.ttl--;
        }
    });
}, Number(configuration.cacheCycle) * 1000);

/**
 * Content of a cached resource.
 */
class CacheValue {
    data: string | Buffer;
    dataType: "txt" | "bin";
    ttl: number;
    gzipData: Buffer;
    brotliData: Buffer;
    contentType: string;
    hash: string;
    size: number = 0;
    filePath: string | null = null;
    mtimeMs: number = 0;
    lastValidated: number = 0;

    /**
     * Computes the total memory held by the resource variants.
     *
     * @returns {void}
     */
    updateSize(): void {
        this.size = Buffer.byteLength(this.data || "")
            + (this.gzipData ? this.gzipData.length : 0)
            + (this.brotliData ? this.brotliData.length : 0);
    }

    /**
     * Caching a local file.
     *
     * @param {string} filePath
     * @param {string} requestUrl
     * @param {string} contentType
     * @returns {Promise<void>}
     */
    async localFile(filePath: string, requestUrl: string, contentType: string): Promise<void> {
        this.contentType = contentType;
        this.filePath = filePath;
        const localPath = resolveLocalPath(filePath);
        const details = await stat(localPath);
        this.mtimeMs = details.mtimeMs;
        this.lastValidated = Date.now();
        const originalData = await readFileFromDisk(localPath);

        if (CONVERTIBLE_CONTENT_TYPE.indexOf(contentType) !== -1) {
            this.data = originalData;
            this.dataType = "bin";
            const converted = await convertResource(this.data, contentType);
            this.data = converted.data;
            this.contentType = converted.contentType;
            this.hash = sha256Hex(this.data);
        } else if (TXT_CONETENT_TYPE.indexOf(contentType) !== -1) {
            this.data = originalData.toString("utf8");
            this.dataType = "txt";

            if (contentType === configuration.contentType.html && configuration.enableIsomorphic)
                this.data = await renderChromium(this.data, requestUrl) || await evaluateHtmlFile(this.data, requestUrl);

            this.hash = sha256Hex(this.data);

            switch(contentType) {
                case configuration.contentType.html:
                    this.data = await minifyHtml(this.data, this.hash);
                    break;
                case configuration.contentType.css:
                    this.data = await minifyCss(this.data, this.hash);
                    break;
                case configuration.contentType.js:
                    this.data = await minifyJs(this.data, this.hash);
                    break;
                case configuration.contentType.json:
                    this.data = await minifyJson(this.data, this.hash);
                    break;
                case configuration.contentType.svg:
                    this.data = await minifySvg(this.data, this.hash);
                    break;
                case configuration.contentType.xml:
                    this.data = await minifyXml(this.data, this.hash);
                    break;
            }

            // Compresses only the text formats, outside of the event loop.
            const compressed = await compressionPool.compress(this.data);
            this.gzipData = compressed.gzipData;
            this.brotliData = compressed.brotliData;
        } else {
            this.data = originalData;
            this.dataType = "bin";
            this.hash = sha256Hex(this.data);
        }

        this.ttl = 0;
        this.updateSize();
    }

    /**
     * Caching a remote file.
     *
     * @param {string} requestUrl
     * @returns {Promise<void>}
     */
    async proxyFile(requestUrl: string): Promise<void> {
        const buffer = await new Promise((resolve: (buffer: Buffer) => void, reject) => {
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
            const compressed = await compressionPool.compress(this.data);
            this.gzipData = compressed.gzipData;
            this.brotliData = compressed.brotliData;
        } else {
            this.dataType = "bin";
            const converted = await convertResource(buffer, contentType);
            this.data = converted.data;
            this.contentType = converted.contentType;
        }

        this.hash = sha256Hex(this.data);
        this.ttl = 0;
        this.updateSize();
    }
}

/**
 * Converts a binary resource if its type allows it.
 *
 * @param {Buffer} data
 * @param {string} contentType
 * @returns {Promise<{data: Buffer, contentType: string}>}
 */
async function convertResource(data: Buffer, contentType: string): Promise<{ data: Buffer; contentType: string }> {
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
function evaluateHtmlFile(content: string, requestUrl: string): Promise<string> {
    return new Promise(async (resolve: (html: string) => void) => {
        // Declares a virtual DOM.
        const dom = new jsdom.JSDOM(content, {
            url: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            referrer: `http://127.0.0.1:${configuration.port}${requestUrl}`,
            contentType: "text/html",
            virtualConsole,
            includeNodeLocations: true,
            runScripts: "outside-only",
        });

        const vmContext = dom.getInternalVMContext();

        /**
         * Function to execute a script in the virtual DOM.
         *
         * @param {string} scriptTxt
         */
        const executeScript = (scriptTxt: string): void => {
            try {
                new Script(scriptTxt).runInContext(vmContext);
            } catch(err) {
                logger.error("Error with script execution", err);
            }
        }

        // Finds the source of each script and sends it to the `executeScript` function.
        const scriptsPromises = [...dom.window.document.getElementsByTagName("script").valueOf()]
            .map(async script => {
                if (script.attributes && script.attributes.src && script.attributes.src.value) {
                    const scriptSrc = script.attributes.src.value;

                    if (/^http[s]?:\/\//.test(scriptSrc)) {
                        await new Promise((resolve: () => void) => {
                            let buffer = Buffer.alloc(0);
                            (scriptSrc.split(":")[0] === "https" ? https : http).get(parse(scriptSrc), res => {
                                res.on("data", data => {
                                    buffer = Buffer.concat([buffer, data]);
                                }).on("end", () => {
                                    executeScript(buffer.toString());
                                    resolve();
                                });
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

        // Waits for each script source to be loaded and executed before checking the dom stability.
        await Promise.all(scriptsPromises);

        // Checks if the dom is still being modified. If not, displays its current status.

        let increment = 0;
        let lastComputedHtmlMd5 = "";

        const loop = setInterval((): void => {
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
 * Gets a cached resource or shares its in-progress loading.
 *
 * @param {string} cacheKey
 * @param {() => Promise<CacheValue>} loader
 * @returns {Promise<CacheValue>}
 */
async function getResource(cacheKey: string, loader: () => Promise<CacheValue>): Promise<CacheValue> {
    const cachedValue = cache.get(cacheKey);
    if (cachedValue) {
        if (cachedValue.filePath && Date.now() - cachedValue.lastValidated >= CACHE_VALIDATION_INTERVAL) {
            cachedValue.lastValidated = Date.now();
            try {
                const details = await stat(resolveLocalPath(cachedValue.filePath));
                if (details.mtimeMs !== cachedValue.mtimeMs) removeCachedResource(cacheKey);
            } catch(err) {
                if (err.code === "ENOENT") removeCachedResource(cacheKey);
                else throw err;
            }
        }

        if (cache.get(cacheKey) === cachedValue) {
            cachedValue.ttl++;
            touchCachedResource(cacheKey, cachedValue);
            return cachedValue;
        }
    }

    let pendingResource = pendingResources.get(cacheKey);
    if (!pendingResource) {
        pendingResource = loader().then(cacheValue => {
            storeCachedResource(cacheKey, cacheValue);
            return cacheValue;
        }).finally(() => {
            pendingResources.delete(cacheKey);
        });
        pendingResources.set(cacheKey, pendingResource);
    }

    const cacheValue = await pendingResource;
    cacheValue.ttl++;
    return cacheValue;
}

/**
 * Reads the contents of a resource from the `dist` folder.
 *
 * @param {string} filePath
 * @param {string} requestUrl
 * @param {string} contentType
 * @returns {Promise<CacheValue>}
 */
function readFile(filePath: string, requestUrl: string, contentType: string): Promise<CacheValue> {
    const cacheKey = configuration.enableIsomorphic && contentType === configuration.contentType.html ? requestUrl : filePath;
    return getResource(cacheKey, async () => {
        const cacheValue = new CacheValue();
        await cacheValue.localFile(filePath, requestUrl, contentType);
        return cacheValue;
    });
}

/**
 * Retrieves the content of a remote resource.
 *
 * @param {string} requestUrl
 * @returns {Promise<CacheValue>}
 */
function readProxy(requestUrl: string): Promise<CacheValue> {
    return getResource(requestUrl, async () => {
        const cacheValue = new CacheValue();
        await cacheValue.proxyFile(requestUrl);
        return cacheValue;
    });
}

module.exports = {
    readFile,
    readProxy,
};