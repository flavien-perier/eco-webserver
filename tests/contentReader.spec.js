const proxyquire = require("proxyquire").noPreserveCache();

describe("contentReader", () => {
    it("Shares an in-progress resource between concurrent requests", async () => {
        let compressionCount = 0;

        class CompressionPool {
            async compress(data) {
                compressionCount++;
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
                    contentType: { html: "text/html" },
                    proxy: {},
                },
                "@global": true,
            },
            "./compressionPool.cts": { CompressionPool },
            "./minifyHtml.cts": async data => data,
            "./Logger.cts": class { error() {} },
        });

        const values = await Promise.all(Array.from({ length: 8 }, () =>
            readFile("index.html", "/index.html", "text/html")
        ));

        expect(compressionCount).toEqual(1);
        expect(values.every(value => value === values[0])).toBeTrue();
    });
});
