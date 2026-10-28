const fs = require("fs");
const { join } = require("path");
const proxyquire = require("proxyquire").noPreserveCache();

const FIXTURE_ROOT = join("/tmp/opencode", `eco-content-reader-edge-${process.pid}`);

const CONTENT_TYPES = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    xml: "application/xml",
    text: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    tif: "image/tiff",
    tiff: "image/tiff",
    webp: "image/webp",
    ttf: "font/ttf",
    otf: "font/otf",
    woff2: "font/woff2",
};

function loadReader(configuration = {}, overrides = {}) {
    const state = { compressionCount: 0 };

    class CompressionPool {
        async compress(data, encoding) {
            state.compressionCount++;
            if (overrides.compress) return overrides.compress(data, encoding);
            if (encoding) return Buffer.from(data);
            return {
                gzipData: Buffer.from(data),
                brotliData: Buffer.from(data),
            };
        }
    }

    const reader = proxyquire("../src/contentReader.ts", {
        "./configuration.ts": {
            default: {
                port: 8080,
                cacheCycle: 1800,
                distDir: FIXTURE_ROOT,
                cacheDir: join(FIXTURE_ROOT, "processing-cache"),
                logDir: "/dev/null",
                enableIsomorphic: false,
                cacheValidationInterval: 60000,
                processingConcurrency: 4,
                processingMaxQueue: 100,
                contentType: CONTENT_TYPES,
                proxy: {},
                ...configuration,
            },
            "@global": true,
        },
        "./compressionPool.ts": { CompressionPool },
        "fs/promises": overrides.fsPromises || {
            readFile: fs.promises.readFile,
            stat: fs.promises.stat,
        },
        "./minifyHtml.ts": overrides.minifyHtml || (async data => data),
        "./minifyCss.ts": async data => data,
        "./minifyJs.ts": async data => data,
        "./minifyJson.ts": async data => data,
        "./minifySvg.ts": async data => data,
        "./minifyXml.ts": async data => data,
        "./convertImage.ts": overrides.convertImage || (async () => null),
        "./convertFont.ts": overrides.convertFont || (async () => null),
        "./renderChromium.ts": overrides.renderChromium || (async () => null),
        "./jsdomRenderer.ts": overrides.renderJsdom || (async data => data),
        "./processingCache.ts": overrides.processingCache || {
            readProcessingCache: async () => null,
            writeProcessingCache: async () => {},
        },
        "./httpRequest.ts": overrides.requestBuffer || (async () => {
            throw new Error("Unexpected proxy request");
        }),
        "./Logger.ts": class { error() {} info() {} },
    });

    return { ...reader, state };
}

function writeFixture(name: string, data: string | Buffer): string {
    const location = join(FIXTURE_ROOT, name);
    fs.mkdirSync(join(location, ".."), { recursive: true });
    fs.writeFileSync(location, data);
    return location;
}

function proxyResponse(body: string | Buffer, contentType?: string, statusCode: number = 200) {
    return {
        buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
        headers: contentType === undefined ? {} : { "content-type": contentType },
        statusCode,
    };
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe("contentReader edge cases", () => {
    beforeAll(() => {
        fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
        fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
    });

    afterAll(() => {
        fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    });

    it("Retries a cold load after its shared pending resource rejects", async () => {
        writeFixture("pending-retry.html", "recovered");
        let attempts = 0;
        const { readFile } = loadReader({}, {
            minifyHtml: async data => {
                attempts++;
                if (attempts === 1) throw new Error("transient minification failure");
                return data;
            },
        });

        await expectAsync(
            readFile("pending-retry.html", "/pending-retry.html", "text/html", "")
        ).toBeRejectedWithError("transient minification failure");

        const recovered = await readFile("pending-retry.html", "/pending-retry.html", "text/html", "");
        const cached = await readFile("pending-retry.html", "/pending-retry.html", "text/html", "");
        expect(recovered.data).toBe("recovered");
        expect(cached).toBe(recovered);
        expect(attempts).toBe(2);
    });

    it("Deduplicates concurrent binary reads without starting another disk load", async () => {
        writeFixture("concurrent.bin", Buffer.from([1, 2, 3, 4]));
        let diskReads = 0;
        let notifyStarted: () => void;
        let releaseRead: () => void;
        const started = new Promise<void>(resolve => { notifyStarted = resolve; });
        const gate = new Promise<void>(resolve => { releaseRead = resolve; });
        const { readFile } = loadReader({}, {
            fsPromises: {
                stat: fs.promises.stat,
                readFile: async location => {
                    diskReads++;
                    notifyStarted();
                    await gate;
                    return fs.promises.readFile(location);
                },
            },
        });

        const pending = Array.from({ length: 6 }, () =>
            readFile("concurrent.bin", "/concurrent.bin", "application/octet-stream")
        );
        await started;
        expect(diskReads).toBe(1);
        releaseRead();

        const values = await Promise.all(pending);
        expect(values.every(value => value === values[0])).toBeTrue();
        expect(values[0].data).toEqual(Buffer.from([1, 2, 3, 4]));
    });

    it("Invalidates a deleted file during revalidation and loads its recreation", async () => {
        const location = writeFixture("deleted.html", "before deletion");
        const { readFile } = loadReader({ cacheValidationInterval: 1 });
        const first = await readFile("deleted.html", "/deleted.html", "text/html", "");

        fs.rmSync(location);
        await delay(5);
        await expectAsync(
            readFile("deleted.html", "/deleted.html", "text/html", "")
        ).toBeRejected();

        writeFixture("deleted.html", "after recreation");
        const recreated = await readFile("deleted.html", "/deleted.html", "text/html", "");
        expect(recreated).not.toBe(first);
        expect(recreated.data).toBe("after recreation");
    });

    it("Propagates non-ENOENT revalidation errors without discarding the cached value", async () => {
        writeFixture("stat-error.html", "still cached");
        let failNextStat = false;
        const { readFile } = loadReader({ cacheValidationInterval: 1 }, {
            fsPromises: {
                readFile: fs.promises.readFile,
                stat: async location => {
                    if (failNextStat) {
                        failNextStat = false;
                        const error: any = new Error("stat denied");
                        error.code = "EACCES";
                        throw error;
                    }
                    return fs.promises.stat(location);
                },
            },
        });
        const first = await readFile("stat-error.html", "/stat-error.html", "text/html", "");

        await delay(5);
        failNextStat = true;
        await expectAsync(
            readFile("stat-error.html", "/stat-error.html", "text/html", "")
        ).toBeRejectedWithError("stat denied");

        const cached = await readFile("stat-error.html", "/stat-error.html", "text/html", "");
        expect(cached).toBe(first);
        expect(cached.data).toBe("still cached");
    });

    it("Uses cache hits to update recency before entry-limit eviction", async () => {
        writeFixture("lru-a.html", "A");
        writeFixture("lru-b.html", "B");
        writeFixture("lru-c.html", "C");
        let loads = 0;
        const { readFile } = loadReader({ cacheMaxEntries: 2 }, {
            minifyHtml: async data => {
                loads++;
                return data;
            },
        });

        const a = await readFile("lru-a.html", "/lru-a.html", "text/html", "");
        const b = await readFile("lru-b.html", "/lru-b.html", "text/html", "");
        expect(await readFile("lru-a.html", "/lru-a.html", "text/html", "")).toBe(a);
        await readFile("lru-c.html", "/lru-c.html", "text/html", "");

        expect(await readFile("lru-a.html", "/lru-a.html", "text/html", "")).toBe(a);
        expect(await readFile("lru-b.html", "/lru-b.html", "text/html", "")).not.toBe(b);
        expect(loads).toBe(4);
    });

    it("Never retains a resource larger than the total cache size limit", async () => {
        writeFixture("oversize.bin", Buffer.from("12345"));
        const { readFile } = loadReader({ cacheMaxSize: 4 });

        const first = await readFile("oversize.bin", "/oversize.bin", "application/octet-stream");
        const second = await readFile("oversize.bin", "/oversize.bin", "application/octet-stream");

        expect(first.size).toBe(5);
        expect(second).not.toBe(first);
        expect(second.data).toEqual(first.data);
    });

    it("Reconciles the LRU size when a lazy compressed variant causes eviction", async () => {
        writeFixture("lazy-size-a.html", "aaaaa");
        writeFixture("lazy-size-b.html", "bbbbb");
        let loads = 0;
        const { readFile } = loadReader({ cacheMaxSize: 12 }, {
            minifyHtml: async data => {
                loads++;
                return data;
            },
            compress: async (data, encoding) => encoding === "gzip" ? Buffer.alloc(20, 1) : Buffer.from(data),
        });
        const a = await readFile("lazy-size-a.html", "/lazy-size-a.html", "text/html", "");
        const b = await readFile("lazy-size-b.html", "/lazy-size-b.html", "text/html", "");

        const response = await a.responseData("gzip");
        expect(response.encoding).toBe("gzip");
        expect(response.body.length).toBe(20);
        expect(await readFile("lazy-size-b.html", "/lazy-size-b.html", "text/html", "")).toBe(b);
        expect(await readFile("lazy-size-a.html", "/lazy-size-a.html", "text/html", "")).not.toBe(a);
        expect(loads).toBe(3);
    });

    it("Caches empty text without manufacturing compressed variants", async () => {
        writeFixture("empty.html", "");
        const { readFile, state } = loadReader();

        const first = await readFile("empty.html", "/empty.html", "text/html", "");
        const second = await readFile("empty.html", "/empty.html", "text/html", "");

        expect(first.data).toBe("");
        expect(first.dataType).toBe("txt");
        expect(first.size).toBe(0);
        expect(first.gzipData).toBeUndefined();
        expect(first.brotliData).toBeUndefined();
        expect(second).toBe(first);
        expect(state.compressionCount).toBe(0);
    });

    it("Caches an empty binary body and always serves it without content encoding", async () => {
        writeFixture("empty.bin", Buffer.alloc(0));
        const { readFile, state } = loadReader();

        const value = await readFile("empty.bin", "/empty.bin", "application/octet-stream", "br");
        const response = await value.responseData("br");
        const cached = await readFile("empty.bin", "/empty.bin", "application/octet-stream", "gzip");

        expect(value.dataType).toBe("bin");
        expect(value.data.length).toBe(0);
        expect(response.encoding).toBeFalse();
        expect(response.body).toBe(value.data);
        expect(cached).toBe(value);
        expect(state.compressionCount).toBe(0);
    });

    it("Preserves Unicode text and measures its UTF-8 byte length", async () => {
        const source = "Chaussure été 🌍 — café";
        writeFixture("unicode.html", source);
        const { readFile } = loadReader();

        const value = await readFile("unicode.html", "/unicode.html", "text/html", "");

        expect(value.data).toBe(source);
        expect(value.dataLength).toBe(Buffer.byteLength(source, "utf8"));
        expect(value.size).toBe(Buffer.byteLength(source, "utf8"));
        expect(value.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("Preserves arbitrary binary bytes and ignores Accept-Encoding", async () => {
        const source = Buffer.from([0, 255, 1, 128, 10]);
        writeFixture("bytes.bin", source);
        const { readFile, state } = loadReader();

        const value = await readFile("bytes.bin", "/bytes.bin", "application/octet-stream", "br, gzip");
        const response = await value.responseData("br");

        expect(value.data).toEqual(source);
        expect(value.contentType).toBe("application/octet-stream");
        expect(response.encoding).toBeFalse();
        expect(response.body).toBe(value.data);
        expect(state.compressionCount).toBe(0);
    });

    it("Falls back to original local image bytes when conversion returns null", async () => {
        const source = Buffer.from([137, 80, 78, 71, 0, 1]);
        writeFixture("fallback.png", source);
        let converted: Buffer | null = null;
        const { readFile, state } = loadReader({}, {
            convertImage: async data => {
                converted = data;
                return null;
            },
        });

        const value = await readFile("fallback.png", "/fallback.png", "image/png", "gzip");

        expect(converted).toEqual(source);
        expect(value.data).toEqual(source);
        expect(value.contentType).toBe("image/png");
        expect(value.dataType).toBe("bin");
        expect(state.compressionCount).toBe(0);
    });

    it("Normalizes a proxied conversion MIME while retaining the original parameters on fallback", async () => {
        const source = Buffer.from([1, 3, 3, 7]);
        const { readProxy, state } = loadReader({ proxy: { "/remote": "http://upstream.test" } }, {
            requestBuffer: async () => proxyResponse(source, "IMAGE/PNG; charset=binary", 304),
            convertImage: async () => null,
        });

        const value = await readProxy("/remote/image.png", "br");

        expect(value.data).toEqual(source);
        expect(value.contentType).toBe("IMAGE/PNG; charset=binary");
        expect(value.statusCode).toBe(304);
        expect(state.compressionCount).toBe(0);
    });

    it("Keeps proxied text charset and error status while caching the response", async () => {
        let requests = 0;
        let minifications = 0;
        const { readProxy } = loadReader({ proxy: { "/api": "http://upstream.test" } }, {
            requestBuffer: async () => {
                requests++;
                return proxyResponse("é🌍", "Text/HTML; charset=UTF-8", 404);
            },
            minifyHtml: async data => {
                minifications++;
                return data;
            },
        });

        const first = await readProxy("/api/missing", "");
        const second = await readProxy("/api/missing", "");

        expect(first.data).toBe("é🌍");
        expect(first.contentType).toBe("Text/HTML; charset=UTF-8");
        expect(first.statusCode).toBe(404);
        expect(second).toBe(first);
        expect(requests).toBe(1);
        expect(minifications).toBe(0);
    });

    it("Replaces proxied conversion parameters with the converted MIME type", async () => {
        const converted = Buffer.from("webp-data");
        const { readProxy } = loadReader({ proxy: { "/assets": "http://upstream.test" } }, {
            requestBuffer: async () => proxyResponse("png-data", "image/png; charset=binary", 206),
            convertImage: async () => converted,
        });

        const value = await readProxy("/assets/image.png", "gzip");

        expect(value.data).toBe(converted);
        expect(value.contentType).toBe("image/webp");
        expect(value.statusCode).toBe(206);
        expect(value.dataType).toBe("bin");
    });

    it("Retries a proxy request after an upstream failure", async () => {
        let attempts = 0;
        const { readProxy } = loadReader({ proxy: { "/api": "http://upstream.test" } }, {
            requestBuffer: async () => {
                attempts++;
                if (attempts === 1) throw new Error("upstream offline");
                return proxyResponse("online", "application/octet-stream");
            },
        });

        await expectAsync(readProxy("/api/retry")).toBeRejectedWithError("upstream offline");
        const value = await readProxy("/api/retry");
        const cached = await readProxy("/api/retry");

        expect(value.data).toEqual(Buffer.from("online"));
        expect(cached).toBe(value);
        expect(attempts).toBe(2);
    });

    it("Uses the longest proxy prefix and forwards URL, timeout and size limits exactly", async () => {
        let captured: any = null;
        const { readProxy } = loadReader({
            proxy: {
                "/api": "http://wrong.test/base",
                "/api/v2": "https://upstream.test/root/",
            },
            proxyTimeout: 1234,
            proxyMaxSize: 5678,
        }, {
            requestBuffer: async (url, timeout, maxSize) => {
                captured = { url: url.toString(), timeout, maxSize };
                return proxyResponse("ok", "application/octet-stream");
            },
        });

        await readProxy("/api/v2/users?q=hello%20world#ignored");

        expect(captured).toEqual({
            url: "https://upstream.test/root/users?q=hello%20world",
            timeout: 1234,
            maxSize: 5678,
        });
    });

    it("Infers a missing proxy MIME type from the request extension", async () => {
        const { readProxy } = loadReader({ proxy: { "/api": "http://upstream.test" } }, {
            requestBuffer: async () => proxyResponse('{"unicode":"🌍"}', undefined),
        });

        const value = await readProxy("/api/data.json", "");

        expect(value.contentType).toBe("application/json");
        expect(value.dataType).toBe("txt");
        expect(value.data).toBe('{"unicode":"🌍"}');
    });

    it("Rejects lexical paths that would escape distDir", async () => {
        const { readFile } = loadReader();

        await expectAsync(
            readFile("../outside.html", "/outside.html", "text/html", "")
        ).toBeRejectedWithError("Invalid resource path");
        await expectAsync(
            readFile("/../../outside.html", "/outside.html", "text/html", "")
        ).toBeRejectedWithError("Invalid resource path");
    });

    it("Keys isomorphic HTML by request URL instead of sharing the file rendering", async () => {
        writeFixture("isomorphic.html", "<p>source</p>");
        const renderedUrls: string[] = [];
        const { readFile } = loadReader({ enableIsomorphic: true }, {
            renderJsdom: async (data, requestUrl) => {
                renderedUrls.push(requestUrl);
                return `${data}:${requestUrl}`;
            },
        });

        const first = await readFile("isomorphic.html", "/first", "text/html", "");
        const second = await readFile("isomorphic.html", "/second", "text/html", "");
        const cached = await readFile("isomorphic.html", "/first", "text/html", "");

        expect(first.data).toBe("<p>source</p>:/first");
        expect(second.data).toBe("<p>source</p>:/second");
        expect(second).not.toBe(first);
        expect(cached).toBe(first);
        expect(renderedUrls).toEqual(["/first", "/second"]);
    });

    it("Regenerates and replaces an expired persistent SSR entry", async () => {
        writeFixture("expired-ssr.html", "source");
        const writes: any[] = [];
        const { readFile } = loadReader({ enableIsomorphic: true, ssrCacheTtl: 1000 }, {
            processingCache: {
                readProcessingCache: async () => Buffer.from(JSON.stringify({
                    createdAt: Date.now() - 5000,
                    html: "stale",
                })),
                writeProcessingCache: async (data, hash, format) => writes.push({ data, hash, format }),
            },
            renderJsdom: async () => "fresh",
        });

        const value = await readFile("expired-ssr.html", "/expired", "text/html", "");

        expect(value.data).toBe("fresh");
        expect(writes.length).toBe(1);
        expect(writes[0].format).toBe("ssr");
        expect(JSON.parse(writes[0].data).html).toBe("fresh");
    });

    it("Regenerates malformed persistent SSR data instead of returning it", async () => {
        writeFixture("corrupt-ssr.html", "source");
        let writes = 0;
        const { readFile } = loadReader({ enableIsomorphic: true, ssrCacheTtl: 60000 }, {
            processingCache: {
                readProcessingCache: async () => Buffer.from("{not-json"),
                writeProcessingCache: async () => { writes++; },
            },
            renderJsdom: async () => "regenerated",
        });

        const value = await readFile("corrupt-ssr.html", "/corrupt", "text/html", "");

        expect(value.data).toBe("regenerated");
        expect(writes).toBe(1);
    });

    it("Clears a rejected lazy compression promise so a later request can retry", async () => {
        writeFixture("compression-retry.html", "compressible");
        let attempts = 0;
        const { readFile } = loadReader({}, {
            compress: async (data, encoding) => {
                expect(encoding).toBe("br");
                attempts++;
                if (attempts === 1) throw new Error("compression unavailable");
                return Buffer.from("compressed");
            },
        });
        const value = await readFile("compression-retry.html", "/compression-retry.html", "text/html", "");

        await expectAsync(value.responseData("br")).toBeRejectedWithError("compression unavailable");
        const retried = await value.responseData("br");
        const cached = await value.responseData("br");

        expect(retried.body).toEqual(Buffer.from("compressed"));
        expect(cached.body).toBe(retried.body);
        expect(attempts).toBe(2);
    });
});
