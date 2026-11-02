const supertest = require("supertest");
const proxyquire = require("proxyquire").noPreserveCache();

describe("server path resolution cache", () => {
    it("reuses positive and negative file resolutions", async () => {
        let lstatCount = 0;
        const configuration = {
            distDir: "/dist",
            cacheDir: "/tmp/eco-test-cache",
            cacheCycle: 1800,
            cacheMaxEntries: 100,
            cacheValidationInterval: 60000,
            enableIsomorphic: false,
            accessLog: false,
            header: {},
            contentType: { html: "text/html" },
            proxy: {},
            use404File: false,
        };
        const content = {
            data: "ok",
            dataLength: 2,
            dataType: "txt",
            contentType: "text/html",
            hash: "hash",
            statusCode: 200,
            responseData: async () => ({ encoding: false, body: "ok" }),
        };
        const server = proxyquire("../src/server.ts", {
            "./configuration.ts": { default: configuration, "@global": true },
            "./contentReader.ts": {
                readFile: async () => content,
                readProxy: async () => content,
            },
            "./Logger.ts": class { error() {} },
            "fs/promises": {
                lstat: async filePath => {
                    lstatCount++;
                    if (filePath.endsWith("missing")) {
                        const error = new Error("not found");
                        error.code = "ENOENT";
                        throw error;
                    }
                    return { isFile: () => true };
                },
            },
        })();

        await supertest(server).get("/index.html").expect(200);
        await supertest(server).get("/index.html").expect(200);
        expect(lstatCount).toEqual(1);

        await supertest(server).get("/missing").expect(200);
        await supertest(server).get("/missing").expect(200);
        expect(lstatCount).toEqual(2);
    });
});
