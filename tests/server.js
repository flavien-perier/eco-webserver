const supertest = require("supertest");

const ecoWebserver = require("../src/server");
const testTools = require("./testTools");

describe("server", () => {
    
    describe("Simple configuration", () => {
        let configuration;

        beforeAll(() => {
            configuration = {
                port: 8080,
                cacheCycle: 1800,
                distDir: "tests/testDist/simple",
                enableIsomorphic: false,
                header: {},
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
                        </html>`
                    );
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
                        </html>`
                    );
                    done();
                });
        });
    });
});
