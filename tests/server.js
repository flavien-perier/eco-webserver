const supertest = require("supertest");
const fs = require("fs");

const ecoWebserver = require("../src/server");
const testTools = require("./testTools");

describe("server", () => {
    describe("Simple configuration", () => {
        let configuration;

        beforeAll(() => {
            configuration = {
                port: 8080,
                cacheCycle: 1800,
                distDir: "./tests/testDist/simple",
                enableIsomorphic: false,
                header: {
                    "Test-Header": "Header-Value"
                },
                contentType: {},
                proxy : {}
            }
        });
    
        it("Should display a page", done => {
            supertest(ecoWebserver(configuration))
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
            supertest(ecoWebserver(configuration))
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
            supertest(ecoWebserver(configuration))
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
        let configuration;

        beforeAll(() => {
            configuration = {
                port: 8080,
                cacheCycle: 1800,
                distDir: "./tests/testDist/404",
                enableIsomorphic: false,
                header: {},
                contentType: {},
                proxy : {}
            }
        });
    
        it("Should display a page with 404", done => {
            supertest(ecoWebserver(configuration))
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
        let configuration;
        const SANDBOX_DIR = "./tests/testDist/sandbox"

        beforeAll(() => {
            fs.mkdirSync(SANDBOX_DIR);

            configuration = {
                port: 8080,
                cacheCycle: 10,
                distDir: SANDBOX_DIR,
                enableIsomorphic: false,
                header: {},
                contentType: {},
                proxy : {}
            }
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

            const server = ecoWebserver(configuration);

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
