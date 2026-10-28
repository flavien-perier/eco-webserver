const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_FILE = "./tests/testDist/simple/cache-freshness.html";

function loadReader(configuration = {}) {
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

    const { readFile } = proxyquire("../src/contentReader.cts", {
        "./configuration.cts": {
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
        "./compressionPool.cts": { CompressionPool },
        "./minifyHtml.cts": async data => data,
        "./minifySvg.cts": async data => data,
        "./Logger.cts": class { error() {} },
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
});
