const fs = require("fs");
const http = require("http");
const { gunzipSync, brotliDecompressSync } = require("zlib");
const supertest = require("supertest");
const proxyquire = require("proxyquire").noPreserveCache();

const testTools = require("./testTools.ts");

const TEST_CACHE = "/tmp/eco-test-cache";

/**
 * Sends a request to the server and recovers the raw response.
 *
 * @param {http.Server} server
 * @param {string} path
 * @param {{[string]: string}} headers
 * @returns {Promise<{statusCode: number, headers: {[string]: string}, body: Buffer}>}
 */
const requestRaw = (server, path, headers) => new Promise((resolve, reject) => {
    const req = http.request({ port: server.address().port, path: path, headers: headers || {} }, res => {
        let body = Buffer.alloc(0);
        res.on("data", data => {
            body = Buffer.concat([body, data]);
        });
        res.on("end", () => {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: body });
        });
    });

    req.on("error", reject);
    req.end();
});

describe("server", () => {
    describe("Simple configuration", () => {
        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {
                        "Test-Header": "Header-Value",
                    },
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json",
                        "svg": "image/svg+xml",
                        "xml": "application/xml",
                        "png": "image/png",
                        "webp": "image/webp",
                        "otf": "font/otf",
                        "ttf": "font/ttf",
                        "woff": "font/woff",
                        "woff2": "font/woff2",
                    },
                    proxy : {},
                    use404File: false,
                },
                "@global": true,
            }
        };

        beforeEach(() => {
            fs.mkdirSync(TEST_CACHE);
        });

        afterEach(() => {
            fs.rmSync(TEST_CACHE, { recursive: true, force: true });
        });

        it("Should display a page", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>Simple</title>
                            </head>
                            <body>
                                <h1>Simple</h1>
                            </body>
                        </html>`);
                    done();
                });
        });

        it("Should display a minified svg", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test.svg")
                .expect(200)
                .expect("Content-Type", "image/svg+xml")
                .end((err, res) => {
                    expect(err).toBeNull();
                    const svg = (res.text || res.body.toString());
                    expect(svg).not.toContain("Test comment");
                    expect(svg).not.toContain("metadata");
                    expect(svg).toContain("<path");
                    done();
                });
        });

        it("Should serve a static file with a query string", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test.svg?v=123")
                .expect(200)
                .expect("Content-Type", "image/svg+xml")
                .expect("Vary", "Accept-Encoding")
                .end(err => {
                    expect(err).toBeNull();
                    done();
                });
        });

        it("Should keep directory traversal inside the dist directory", async () => {
            const server = proxyquire("../src/server.cts", mockConfiguration)();
            await new Promise(resolve => server.listen(0, resolve));

            try {
                const { statusCode, body } = await requestRaw(server, "/../../../package.json");
                expect(statusCode).toEqual(200);
                expect(body.toString()).not.toContain('"name": "eco-webserver"');
            } finally {
                await new Promise(resolve => {
                    server.close(resolve);
                    server.closeAllConnections();
                });
            }
        });

        it("Should display a page with a redirection", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/redirection")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>Simple</title>
                            </head>
                            <body>
                                <h1>Simple</h1>
                            </body>
                        </html>`);
                    done();
                });
        });

        it("Should display a page with a custom header", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/")
                .expect(200)
                .expect("Content-Type", "text/html")
                .expect("Test-Header", "Header-Value")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>Simple</title>
                            </head>
                            <body>
                                <h1>Simple</h1>
                            </body>
                        </html>`);
                    done();
                });
        });

        it("Should display a page with etag", done => {
            const etag = "d68ffeb0ba128b157bc38ed5620b0a2f66bf792d465b43b99d83d8e33571364b";

            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/")
                .expect(200)
                .expect("Content-Type", "text/html")
                .expect("etag", etag)
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>Simple</title>
                            </head>
                            <body>
                                <h1>Simple</h1>
                            </body>
                        </html>`);

                        supertest(proxyquire("../src/server.cts", mockConfiguration)())
                            .get("/redirection")
                            .set("If-None-Match", etag)
                            .expect(304)
                            .expect("Content-Type", "text/html")
                            .end((err, res) => {
                                expect(err).toBeNull();
                                expect(res.text).toEqual("");
                                done();
                            });
                });
        });
    });

    describe("Configuration with 404", () => {
        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/404",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json",
                    },
                    proxy : {},
                    use404File: true
                },
                "@global": true
            }
        };

        beforeEach(() => {
            fs.mkdirSync(TEST_CACHE);
        });

        afterEach(() => {
            fs.rmSync(TEST_CACHE, { recursive: true, force: true });
        });

        it("Should display a page with 404", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/redirection")
                .expect(404)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>404</title>
                            </head>
                            <body>
                                <h1>404</h1>
                            </body>
                        </html>`);
                    done();
                });
        });
    });

    describe("Configuration with cache", () => {
        const SANDBOX_DIR = "./tests/testDist/sandbox";

        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 10,
                    distDir: SANDBOX_DIR,
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json",
                    },
                    proxy : {},
                    use404File: false,
                },
                "@global": true,
            }
        };

        beforeEach(() => {
            fs.mkdirSync(TEST_CACHE);
        });

        afterEach(() => {
            fs.rmSync(TEST_CACHE, { recursive: true, force: true });
        });

        beforeAll(() => {
            fs.mkdirSync(SANDBOX_DIR);
        });

        afterAll(() => {
            fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
        });

        it("Should display a page contained in the cache", done => {
            fs.writeFileSync(SANDBOX_DIR + "/index.html", `<!DOCTYPE html>
                <html>
                    <head>
                        <title>Sandbox</title>
                    </head>
                    <body>
                        <h1>Sandbox</h1>
                    </body>
                </html>`);

            const server = proxyquire("../src/server.cts", mockConfiguration)();

            supertest(server)
                .get("/")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                        <html>
                            <head>
                                <title>Sandbox</title>
                            </head>
                            <body>
                                <h1>Sandbox</h1>
                            </body>
                        </html>`);

                    fs.writeFileSync(SANDBOX_DIR + "/index.html", "");
                    fs.rmSync(TEST_CACHE, { recursive: true, force: true });
                    fs.mkdirSync(TEST_CACHE);

                    supertest(server)
                        .get("/")
                        .expect(200)
                        .expect("Content-Type", "text/html")
                        .end((err, res) => {
                            expect(err).toBeNull();
                            testTools.compareHtml(res.text, `<!DOCTYPE html>
                                <html>
                                    <head>
                                        <title>Sandbox</title>
                                    </head>
                                    <body>
                                        <h1>Sandbox</h1>
                                    </body>
                                </html>`);

                            fs.unlinkSync(SANDBOX_DIR + "/index.html");
                            done();
                        });
                });
        });
    });

    describe("Configuration with isomorphic", () => {
        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/isomorphic",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: true,
                    header: {
                        "Test-Header": "Header-Value",
                    },
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json"
                    },
                    proxy : {},
                    use404File: false,
                },
                "@global": true,
            }
        };

        beforeEach(() => {
            fs.mkdirSync(TEST_CACHE);
        });

        afterEach(() => {
            fs.rmSync(TEST_CACHE, { recursive: true, force: true });
        });

        it("Should load JavaScript in the page", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    testTools.compareHtml(res.text, `<!DOCTYPE html>
                    <html>
                        <head>
                            <title>Isomorphic</title>
                        </head>
                        <body>
                            <h1>Isomorphic</h1>
                            <span id=span_1>test script 1</span>
                            <span id=span_2>test script 2</span>
                            <script>
                                document.getElementById("span_1").innerHTML = "test script 1";
                            </script>
                            <script src=./script.js></script>
                        </body>
                    </html>`);
                    done();
                });
        });
    });
    
    describe("Configuration with proxy", () => {
        const TEST_PORT = 9999;

        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json",
                    },
                    proxy : {
                        "/test": `http://127.0.0.1:${TEST_PORT}`,
                    },
                    use404File: false,
                },
                "@global": true,
            }
        };

        beforeEach(() => {
            fs.mkdirSync(TEST_CACHE);
        });

        afterEach(() => {
            fs.rmSync(TEST_CACHE, { recursive: true, force: true });
        });

        const server = http.createServer((req, res) => {
            console.log(req.url)
            if (req.url === "/path") {
                res.writeHead(200);
                res.write("test path");
            } else if (req.url === "/error") {
                res.writeHead(418, { "Content-Type": "text/plain; charset=utf-8" });
                res.write("upstream error");
            } else {
                res.writeHead(200);
                res.write("base path");
            }
            res.end();
        });

        beforeAll(() => {
            server.listen(TEST_PORT, null, null, null);
        });

        afterAll(() => {
            server.close();
        });

        it("Should display a remote base path through the proxy", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    expect(res.text).toEqual("base path");
                    done();
                });
        });

        it("Should display a remote resource through the proxy", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test/path")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    expect(res.text).toEqual("test path");
                    done();
                });
        });

        it("Should propagate the upstream status and content type", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test/error")
                .expect(418)
                .expect("Content-Type", "text/plain; charset=utf-8")
                .end((err, res) => {
                    expect(err).toBeNull();
                    expect(res.text).toEqual("upstream error");
                    done();
                });
        });

        it("Should not allow the request suffix to change the upstream host", done => {
            supertest(proxyquire("../src/server.cts", mockConfiguration)())
                .get("/test@127.0.0.1:9998/")
                .expect(200)
                .end(err => {
                    expect(err).toBeNull();
                    done();
                });
        });
    });

    describe("Configuration with conversions and compressions", () => {
        const mockConfiguration = {
            "./configuration.cts": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {
                        "html": "text/html",
                        "css": "text/css",
                        "js": "application/javascript",
                        "json": "application/json",
                        "svg": "image/svg+xml",
                        "xml": "application/xml",
                        "png": "image/png",
                        "webp": "image/webp",
                        "otf": "font/otf",
                        "ttf": "font/ttf",
                        "woff": "font/woff",
                        "woff2": "font/woff2",
                    },
                    proxy : {},
                    use404File: false,
                },
                "@global": true,
            }
        };

        let server;

        beforeAll(done => {
            fs.mkdirSync(TEST_CACHE);
            server = proxyquire("../src/server.cts", mockConfiguration)();
            server.listen(0, null, null, done);
        });

        afterAll(done => {
            server.close(() => {
                fs.rmSync(TEST_CACHE, { recursive: true, force: true });
                done();
            });
        });

        it("Should convert an image into webp without compression", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/image.png");

            expect(statusCode).toEqual(200);
            expect(headers["content-type"]).toEqual("image/webp");
            expect(headers["content-encoding"]).toBeUndefined();
            expect(body.subarray(0, 4).toString()).toEqual("RIFF");
            expect(body.subarray(8, 12).toString()).toEqual("WEBP");
        });

        it("Should convert a font into woff2", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/test.otf");

            expect(statusCode).toEqual(200);
            expect(headers["content-type"]).toEqual("font/woff2");
            expect(body.subarray(0, 4).toString()).toEqual("wOF2");
        });

        it("Should minify a xml file", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/sitemap.xml");

            const xml = body.toString();

            expect(statusCode).toEqual(200);
            expect(headers["content-type"]).toEqual("application/xml");
            expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
            expect(xml).not.toContain("Test comment");
            expect(xml).not.toMatch(/>\s+</);
        });

        it("Should compress a text file with brotli", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/test.svg", { "Accept-Encoding": "gzip, br" });

            const svg = brotliDecompressSync(body).toString();

            expect(statusCode).toEqual(200);
            expect(headers["content-encoding"]).toEqual("br");
            expect(svg).toContain("<path");
            expect(svg).not.toContain("Test comment");
        });

        it("Should compress a text file with gzip", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/test.svg", { "Accept-Encoding": "gzip" });

            const svg = gunzipSync(body).toString();

            expect(statusCode).toEqual(200);
            expect(headers["content-encoding"]).toEqual("gzip");
            expect(svg).toContain("<path");
        });

        it("Should respect refused encodings and expose cache variance", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/test.svg", { "Accept-Encoding": "br;q=0, gzip;q=0" });

            expect(statusCode).toEqual(200);
            expect(headers["content-encoding"]).toBeUndefined();
            expect(headers.vary).toEqual("Accept-Encoding");
            expect(Number(headers["content-length"])).toEqual(body.length);
            expect(body.toString()).toContain("<path");
        });

        it("Should send a text file without compression", async () => {
            const { statusCode, headers, body } = await requestRaw(server, "/test.svg");

            expect(statusCode).toEqual(200);
            expect(headers["content-encoding"]).toBeUndefined();
            expect(body.toString()).toContain("<path");
        });
    });
});
