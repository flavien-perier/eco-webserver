"use strict";

const { readFile: readFileFromDisk, stat } = require("fs/promises");
const { resolve, sep } = require("path");
const { createHash } = require("crypto");

const configuration = require("./configuration.ts").default;
const getContentType = require("./getContentType.ts");
const minifyHtml = require("./minifyHtml.ts");
const minifyCss = require("./minifyCss.ts");
const minifyJs = require("./minifyJs.ts");
const minifyJson = require("./minifyJson.ts");
const minifySvg = require("./minifySvg.ts");
const minifyXml = require("./minifyXml.ts");
const convertImage = require("./convertImage.ts");
const convertFont = require("./convertFont.ts");
const renderChromium = require("./renderChromium.ts");
const renderJsdom = require("./jsdomRenderer.ts");
const { CompressionPool } = require("./compressionPool.ts");
const { readProcessingCache, writeProcessingCache } = require("./processingCache.ts");
const { preferredEncoding } = require("./contentEncoding.ts");
const requestBuffer = require("./httpRequest.ts");
const TaskLimiter = require("./taskLimiter.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

/**
 * Number of workers compressing the text resources outside of the event loop.
 */
const COMPRESSION_POOL_SIZE = Math.max(1, Number(configuration.compressionPoolSize) || 4);

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
const PROXY_TIMEOUT = Math.max(1, Number(process.env.ECO_PROXY_TIMEOUT || configuration.proxyTimeout) || 10000);
const PROXY_MAX_SIZE = Math.max(1, Number(process.env.ECO_PROXY_MAX_SIZE || configuration.proxyMaxSize) || 50 * 1024 * 1024);
const PROCESSING_CONCURRENCY = Math.max(1, Number(configuration.processingConcurrency) || 4);
const PROCESSING_MAX_QUEUE = Math.max(0, Number(configuration.processingMaxQueue ?? 100));
const SSR_CACHE_TTL = Math.max(0, Number(configuration.ssrCacheTtl) || 0);
const processingLimiter = new TaskLimiter(PROCESSING_CONCURRENCY, PROCESSING_MAX_QUEUE);
const PROXY_PREFIXES = Object.keys(configuration.proxy).sort((a, b) => b.length - a.length);

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
 * Builds an upstream URL while preserving the configured origin.
 *
 * @param {string} requestUrl
 * @returns {URL}
 */
function buildProxyUrl(requestUrl: string): URL {
    const request = new URL(requestUrl, "http://localhost");
    const requestBaseUrl = PROXY_PREFIXES.find(key => request.pathname.startsWith(key));
    const proxyUrl = new URL(configuration.proxy[requestBaseUrl]);
    const basePath = proxyUrl.pathname.endsWith("/") ? proxyUrl.pathname.slice(0, -1) : proxyUrl.pathname;
    const suffix = request.pathname.slice(requestBaseUrl.length);

    proxyUrl.pathname = `${basePath}${suffix}` || "/";
    proxyUrl.search = request.search;
    proxyUrl.hash = "";
    return proxyUrl;
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
 * Evicts least recently used entries until both cache limits are satisfied.
 *
 * @returns {void}
 */
function enforceCacheLimits(): void {
    while (cache.size > CACHE_MAX_ENTRIES || cacheSize > CACHE_MAX_SIZE) {
        removeCachedResource(cache.keys().next().value);
    }
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
    enforceCacheLimits();
}

/**
 * Reconciles the LRU size after a lazy compressed variant has been added.
 *
 * @param {CacheValue} value
 * @param {number} previousSize
 * @returns {void}
 */
function refreshCachedResourceSize(value: CacheValue, previousSize: number): void {
    if (!value.cacheKey || cache.get(value.cacheKey) !== value) return;
    cacheSize += value.size - previousSize;
    enforceCacheLimits();
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
    dataLength: number = 0;
    ttl: number;
    gzipData: Buffer;
    brotliData: Buffer;
    gzipPromise: Promise<Buffer> | null = null;
    brotliPromise: Promise<Buffer> | null = null;
    contentType: string;
    hash: string;
    size: number = 0;
    cacheKey: string | null;
    filePath: string | null = null;
    mtimeMs: number = 0;
    lastValidated: number = 0;
    statusCode: number = 200;

    /**
     * @param {string | null} cacheKey
     */
    constructor(cacheKey: string | null = null) {
        this.cacheKey = cacheKey;
    }

    /**
     * Computes the total memory held by the resource variants.
     *
     * @returns {void}
     */
    updateSize(): void {
        this.dataLength = Buffer.byteLength(this.data || "");
        this.size = this.dataLength
            + (this.gzipData ? this.gzipData.length : 0)
            + (this.brotliData ? this.brotliData.length : 0);
    }

    /**
     * Generates one compressed variant once and shares concurrent computations.
     *
     * @param {"gzip" | "br"} encoding
     * @returns {Promise<Buffer>}
     */
    ensureCompression(encoding: "gzip" | "br"): Promise<Buffer> {
        const dataProperty = encoding === "br" ? "brotliData" : "gzipData";
        const promiseProperty = encoding === "br" ? "brotliPromise" : "gzipPromise";
        if (this[dataProperty]) return Promise.resolve(this[dataProperty]);
        if (this[promiseProperty]) return this[promiseProperty];

        const promise = compressionPool.compress(this.data, encoding).then((compressed: any) => {
            const previousSize = this.size;
            const buffer = Buffer.isBuffer(compressed)
                ? compressed
                : encoding === "br" ? compressed.brotliData : compressed.gzipData;
            this[dataProperty] = buffer;
            this.updateSize();
            refreshCachedResourceSize(this, previousSize);
            return buffer;
        }).finally(() => {
            this[promiseProperty] = null;
        });
        this[promiseProperty] = promise;
        return promise;
    }

    /**
     * Generates only variants useful to the current client. Direct callers that
     * omit Accept-Encoding retain the historical eager gzip+Brotli behavior.
     *
     * @param {string} [acceptEncoding]
     * @returns {Promise<void>}
     */
    async prepareRequestedCompressions(acceptEncoding?: string): Promise<void> {
        if (this.dataType !== "txt") return;

        if (acceptEncoding === undefined) {
            const previousSize = this.size;
            const compressed = await compressionPool.compress(this.data);
            this.gzipData = compressed.gzipData;
            this.brotliData = compressed.brotliData;
            this.updateSize();
            refreshCachedResourceSize(this, previousSize);
            return;
        }

        const encoding = preferredEncoding(acceptEncoding);
        if (encoding) await this.ensureCompression(encoding);
    }

    /**
     * Selects and, when necessary, lazily creates the response body.
     *
     * @param {string} acceptEncoding
     * @returns {Promise<{encoding: "br" | "gzip" | false, body: string | Buffer}>}
     */
    async responseData(acceptEncoding: string): Promise<{ encoding: "br" | "gzip" | false; body: string | Buffer }> {
        const encoding = this.dataType === "txt" ? preferredEncoding(acceptEncoding) : false;
        if (encoding === "br") return { encoding, body: await this.ensureCompression("br") };
        if (encoding === "gzip") return { encoding, body: await this.ensureCompression("gzip") };
        return { encoding: false, body: this.data };
    }

    /**
     * Caching a local file.
     *
     * @param {string} filePath
     * @param {string} requestUrl
     * @param {string} contentType
     * @param {string} [acceptEncoding]
     * @returns {Promise<void>}
     */
    async localFile(filePath: string, requestUrl: string, contentType: string, acceptEncoding?: string): Promise<void> {
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

            if (contentType === configuration.contentType.html && configuration.enableIsomorphic) {
                const sourceHash = sha256Hex(this.data);
                this.data = await renderHtml(this.data, requestUrl, sourceHash);
            }

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

            await this.prepareRequestedCompressions(acceptEncoding);
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
     * @param {string} [acceptEncoding]
     * @returns {Promise<void>}
     */
    async proxyFile(requestUrl: string, acceptEncoding?: string): Promise<void> {
        const response = await requestBuffer(buildProxyUrl(requestUrl), PROXY_TIMEOUT, PROXY_MAX_SIZE);
        const buffer = response.buffer;
        const contentType = response.headers["content-type"] || getContentType(requestUrl);
        const mimeType = contentType.split(";", 1)[0].trim().toLowerCase();
        this.statusCode = response.statusCode;

        if (TXT_CONETENT_TYPE.indexOf(mimeType) !== -1) {
            this.data = buffer.toString("utf8");
            this.dataType = "txt";
            this.contentType = contentType;
            await this.prepareRequestedCompressions(acceptEncoding);
        } else {
            this.dataType = "bin";
            const converted = await convertResource(buffer, mimeType);
            this.data = converted.data;
            this.contentType = converted.contentType === mimeType ? contentType : converted.contentType;
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
 * Renders HTML, optionally reusing a persistent SSR result for static sites.
 *
 * @param {string} content
 * @param {string} requestUrl
 * @param {string} sourceHash
 * @returns {Promise<string>}
 */
async function renderHtml(content: string, requestUrl: string, sourceHash: string): Promise<string> {
    const cacheKey = sha256Hex(`ssr-v1\0${requestUrl}\0${sourceHash}`);

    if (SSR_CACHE_TTL > 0) {
        const cached = await readProcessingCache(cacheKey, "ssr");
        if (cached) {
            try {
                const entry = JSON.parse(cached.toString());
                if (Date.now() - entry.createdAt < SSR_CACHE_TTL && typeof entry.html === "string") {
                    return entry.html;
                }
            } catch(err) {
                // A malformed optional SSR entry is simply regenerated.
            }
        }
    }

    const rendered = await renderChromium(content, requestUrl) || await renderJsdom(content, requestUrl);
    if (SSR_CACHE_TTL > 0) {
        await writeProcessingCache(JSON.stringify({ createdAt: Date.now(), html: rendered }), cacheKey, "ssr");
    }
    return rendered;
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
        pendingResource = processingLimiter.run(loader).then(cacheValue => {
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
 * @param {string} [acceptEncoding]
 * @returns {Promise<CacheValue>}
 */
function readFile(filePath: string, requestUrl: string, contentType: string, acceptEncoding?: string): Promise<CacheValue> {
    const cacheKey = configuration.enableIsomorphic && contentType === configuration.contentType.html ? requestUrl : filePath;
    return getResource(cacheKey, async () => {
        const cacheValue = new CacheValue(cacheKey);
        await cacheValue.localFile(filePath, requestUrl, contentType, acceptEncoding);
        return cacheValue;
    });
}

/**
 * Retrieves the content of a remote resource.
 *
 * @param {string} requestUrl
 * @param {string} [acceptEncoding]
 * @returns {Promise<CacheValue>}
 */
function readProxy(requestUrl: string, acceptEncoding?: string): Promise<CacheValue> {
    return getResource(requestUrl, async () => {
        const cacheValue = new CacheValue(requestUrl);
        await cacheValue.proxyFile(requestUrl, acceptEncoding);
        return cacheValue;
    });
}

module.exports = {
    readFile,
    readProxy,
};
