const fs = require("fs");
const http = require("http");
const supertest = require("supertest");
const proxyquire = require("proxyquire").noPreserveCache();

const testTools = require("./testTools");

const TEST_CACHE = "./tests/test-cache";

describe("server", () => {
    describe("Simple configuration", () => {
        const mockConfiguration = {
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {
                        "Test-Header": "Header-Value"
                    },
                    contentType: {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"},
                    proxy : {},
                    use404File: false,
                    use500File: false
                },
                "@global": true
            }
        };

        const mockRequire = {
            "./minifyCss": proxyquire("../src/minifyCss", mockConfiguration),
            "./minifyHtml": proxyquire("../src/minifyHtml", mockConfiguration),
            "./minifyJs": proxyquire("../src/minifyJs", mockConfiguration),
            "./minifyJson": proxyquire("../src/minifyJson", mockConfiguration),
            ...mockConfiguration
        };

        afterEach(() => {
            fs.rmdirSync(TEST_CACHE, { recursive: true });
        });

        it("Should display a page", done => {
            supertest(proxyquire("../src/server", mockRequire)())
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

        it("Should display a page with a redirection", done => {
            supertest(proxyquire("../src/server", mockRequire)())
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
            supertest(proxyquire("../src/server", mockRequire)())
                .get("/redirection")
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
    });

    describe("Configuration with 404", () => {
        const mockConfiguration = {
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/404",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"},
                    proxy : {},
                    use404File: true,
                    use500File: false
                },
                "@global": true
            }
        };

        const mockRequire = {
            "./minifyCss": proxyquire("../src/minifyCss", mockConfiguration),
            "./minifyHtml": proxyquire("../src/minifyHtml", mockConfiguration),
            "./minifyJs": proxyquire("../src/minifyJs", mockConfiguration),
            "./minifyJson": proxyquire("../src/minifyJson", mockConfiguration),
            ...mockConfiguration
        };

        afterEach(() => {
            fs.rmdirSync(TEST_CACHE, { recursive: true });
        });

        it("Should display a page with 404", done => {
            supertest(proxyquire("../src/server", mockRequire)())
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
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 10,
                    distDir: SANDBOX_DIR,
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"},
                    proxy : {},
                    use404File: false,
                    use500File: false
                },
                "@global": true
            }
        };

        const mockRequire = {
            "./minifyCss": proxyquire("../src/minifyCss", mockConfiguration),
            "./minifyHtml": proxyquire("../src/minifyHtml", mockConfiguration),
            "./minifyJs": proxyquire("../src/minifyJs", mockConfiguration),
            "./minifyJson": proxyquire("../src/minifyJson", mockConfiguration),
            ...mockConfiguration
        };

        afterEach(() => {
            fs.rmdirSync(TEST_CACHE, { recursive: true });
        });

        beforeAll(() => {
            fs.mkdirSync(SANDBOX_DIR);
        });

        afterAll(() => {
            fs.rmdirSync(SANDBOX_DIR, { recursive: true });
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

            const server = proxyquire("../src/server", mockRequire)();

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
                    fs.rmdirSync(TEST_CACHE, { recursive: true });

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
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/isomorphic",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: true,
                    header: {
                        "Test-Header": "Header-Value"
                    },
                    contentType: {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"},
                    proxy : {},
                    use404File: false,
                    use500File: false
                },
                "@global": true
            }
        };

        const mockRequire = {
            "./minifyCss": proxyquire("../src/minifyCss", mockConfiguration),
            "./minifyHtml": proxyquire("../src/minifyHtml", mockConfiguration),
            "./minifyJs": proxyquire("../src/minifyJs", mockConfiguration),
            "./minifyJson": proxyquire("../src/minifyJson", mockConfiguration),
            ...mockConfiguration
        };

        afterEach(() => {
            fs.rmdirSync(TEST_CACHE, { recursive: true });
        });

        it("Should load JavaScript in the page", done => {
            supertest(proxyquire("../src/server", mockRequire)())
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
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
                    cacheDir: TEST_CACHE,
                    logDir: "/dev/null",
                    enableIsomorphic: false,
                    header: {},
                    contentType: {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"},
                    proxy : {
                        "/test": `http://127.0.0.1:${TEST_PORT}`
                    },
                    use404File: false,
                    use500File: false
                },
                "@global": true
            }
        };

        const mockRequire = {
            "./minifyCss": proxyquire("../src/minifyCss", mockConfiguration),
            "./minifyHtml": proxyquire("../src/minifyHtml", mockConfiguration),
            "./minifyJs": proxyquire("../src/minifyJs", mockConfiguration),
            "./minifyJson": proxyquire("../src/minifyJson", mockConfiguration),
            ...mockConfiguration
        };

        afterEach(() => {
            fs.rmdirSync(TEST_CACHE, { recursive: true });
        });

        const server = http.createServer((req, res) => {
            console.log(req.url)
            if (req.url == "/path") {
                res.writeHead(200);
                res.write("test path");
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
            supertest(proxyquire("../src/server", mockRequire)())
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
            supertest(proxyquire("../src/server", mockRequire)())
                .get("/test/path")
                .expect(200)
                .expect("Content-Type", "text/html")
                .end((err, res) => {
                    expect(err).toBeNull();
                    expect(res.text).toEqual("test path");
                    done();
                });
        });
    });
});
