const fs = require("fs");
const { createHash } = require("crypto");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_FILE = "./tests/testDist/simple/cache-freshness.html";

function loadReader(configuration = {}, overrides = {}) {
    const state = { compressionCount: 0 };

    class CompressionPool {
        async compress(data) {
            state.compressionCount++;
            await new Promise(resolve => setTimeout(resolve, 25));
            return {
                gzipData: Buffer.from(data),
                brotliData: Buffer.from(data),
            };
        }
    }

    const { readFile } = proxyquire("../src/contentReader.ts", {
        "./configuration.ts": {
            default: {
                port: 8080,
                cacheCycle: 1800,
                distDir: "./tests/testDist/simple",
                cacheDir: "/tmp/eco-test-cache",
                logDir: "/dev/null",
                enableIsomorphic: false,
                contentType: { html: "text/html", svg: "image/svg+xml" },
                proxy: {},
                ...configuration,
            },
            "@global": true,
        },
        "./compressionPool.ts": { CompressionPool },
        "./minifyHtml.ts": overrides.minifyHtml || (async data => data),
        "./minifySvg.ts": async data => data,
        "./renderChromium.ts": overrides.renderChromium || (async () => null),
        "./jsdomRenderer.ts": overrides.renderJsdom || (async data => data),
        "./processingCache.ts": overrides.processingCache || {
            readProcessingCache: async () => null,
            writeProcessingCache: async () => {},
        },
        "./Logger.ts": class { error() {} info() {} },
    });

    return { readFile, state };
}

describe("contentReader", () => {
    afterEach(() => {
        fs.rmSync(TEST_FILE, { force: true });
    });

    it("Shares an in-progress resource between concurrent requests", async () => {
        const { readFile, state } = loadReader();
        const values = await Promise.all(Array.from({ length: 8 }, () =>
            readFile("index.html", "/index.html", "text/html")
        ));

        expect(state.compressionCount).toEqual(1);
        expect(values.every(value => value === values[0])).toBeTrue();
    });

    it("Shares non-isomorphic fallback content between URLs", async () => {
        const { readFile, state } = loadReader();

        await readFile("index.html", "/missing-a", "text/html");
        await readFile("index.html", "/missing-b", "text/html");

        expect(state.compressionCount).toEqual(1);
    });

    it("Evicts the least recently used entry above the entry limit", async () => {
        const { readFile, state } = loadReader({ cacheMaxEntries: 1 });

        await readFile("index.html", "/index.html", "text/html");
        await readFile("test.svg", "/test.svg", "image/svg+xml");
        await readFile("index.html", "/index.html", "text/html");

        expect(state.compressionCount).toEqual(3);
    });

    it("Reloads a cached file when its modification time changes", async () => {
        const { readFile, state } = loadReader({ cacheValidationInterval: 1 });
        fs.writeFileSync(TEST_FILE, "first version");

        expect((await readFile("cache-freshness.html", "/cache-freshness.html", "text/html")).data).toEqual("first version");
        await new Promise(resolve => setTimeout(resolve, 5));
        fs.writeFileSync(TEST_FILE, "second version");

        expect((await readFile("cache-freshness.html", "/cache-freshness.html", "text/html")).data).toEqual("second version");
        expect(state.compressionCount).toEqual(2);
    });

    it("Creates only the compression variants requested by clients", async () => {
        const { readFile, state } = loadReader();
        const value = await readFile("index.html", "/index.html", "text/html", "");

        expect(state.compressionCount).toEqual(0);
        expect(value.gzipData).toBeUndefined();
        expect(value.brotliData).toBeUndefined();

        await Promise.all([value.responseData("gzip"), value.responseData("gzip")]);
        expect(state.compressionCount).toEqual(1);
        expect(value.gzipData).toBeDefined();
        expect(value.brotliData).toBeUndefined();

        await value.responseData("br");
        expect(state.compressionCount).toEqual(2);
        expect(value.brotliData).toBeDefined();
    });

    it("Uses the final minified bytes as the resource validator", async () => {
        const { readFile } = loadReader({}, {
            minifyHtml: async () => "minified response",
        });
        const value = await readFile("index.html", "/index.html", "text/html", "");

        expect(value.hash).toBe(createHash("sha256").update("minified response").digest("hex"));
    });

    it("Reuses a persistent compressed variant after a reader restart", async () => {
        const artefacts = new Map();
        const processingCache = {
            readProcessingCache: async (hash, format) => artefacts.get(`${hash}.${format}`) || null,
            writeProcessingCache: async (data, hash, format) => {
                artefacts.set(`${hash}.${format}`, Buffer.from(data));
            },
        };

        const firstReader = loadReader({}, { processingCache });
        const first = await firstReader.readFile("index.html", "/index.html", "text/html", "gzip");
        expect(firstReader.state.compressionCount).toEqual(1);
        expect(Array.from(artefacts.keys()).some(key => key.endsWith(".gzip"))).toBeTrue();

        const secondReader = loadReader({}, { processingCache });
        const second = await secondReader.readFile("index.html", "/index.html", "text/html", "gzip");
        const response = await second.responseData("gzip");

        expect(secondReader.state.compressionCount).toEqual(0);
        expect(response.body).toEqual(first.gzipData);
    });

    it("Applies backpressure to distinct cold resources", async () => {
        const { readFile } = loadReader({ processingConcurrency: 1, processingMaxQueue: 0 }, {
            minifyHtml: async data => {
                await new Promise(resolve => setTimeout(resolve, 30));
                return data;
            },
        });

        const first = readFile("index.html", "/index.html", "text/html", "");
        await new Promise(resolve => setTimeout(resolve, 5));
        const second = readFile("test.svg", "/test.svg", "image/svg+xml", "");

        await expectAsync(second).toBeRejectedWithError("Processing queue is full");
        await first;
    });

    it("Reuses a persistent SSR rendering after a reader restart", async () => {
        const artefacts = new Map();
        let renderCount = 0;
        const processingCache = {
            readProcessingCache: async (hash, format) => artefacts.get(`${hash}.${format}`) || null,
            writeProcessingCache: async (data, hash, format) => {
                artefacts.set(`${hash}.${format}`, Buffer.from(data));
            },
        };
        const overrides = {
            processingCache,
            renderJsdom: async data => {
                renderCount++;
                return data;
            },
        };
        const configuration = { enableIsomorphic: true, ssrCacheTtl: 60000 };

        await loadReader(configuration, overrides).readFile("index.html", "/route", "text/html", "");
        await loadReader(configuration, overrides).readFile("index.html", "/route", "text/html", "");

        expect(renderCount).toEqual(1);
    });
});
