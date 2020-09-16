const supertest = require("supertest");
const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const testTools = require("./testTools");

describe("server", () => {
    describe("Simple configuration", () => {
        const mockConfiguration = {
            "./configuration": {
                default: {
                    port: 8080,
                    cacheCycle: 1800,
                    distDir: "./tests/testDist/simple",
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

        it("Should display a page", done => {
            supertest(proxyquire("../src/server", mockConfiguration)())
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
            supertest(proxyquire("../src/server", mockConfiguration)())
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
            supertest(proxyquire("../src/server", mockConfiguration)())
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

        it("Should display a page with 404", done => {
            supertest(proxyquire("../src/server", mockConfiguration)())
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

            const server = proxyquire("../src/server", mockConfiguration)();

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
});
