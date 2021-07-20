const proxyquire = require("proxyquire").noPreserveCache();
const buildHeader = require("../src/buildHeader");

describe("buildHeader", () => {
    const mockConfiguration = {
        "./configuration": {
            default: {
                port: 8080,
                cacheCycle: 1800,
                distDir: "./tests/testDist/simple",
                logDir: "/dev/null",
                enableIsomorphic: false,
                header: {
                    "test": "123",
                },
                contentType: {},
                proxy : {},
                use404File: false,
            },
            "@global": true,
        }
    };

    it("Test the header generation with gzip", () => {
        const header = proxyquire("../src/buildHeader", mockConfiguration)("text/html", true, "hashValue");

        expect(header).toEqual({
            "test": "123",
            "Content-Type": "text/html",
            "Content-Encoding": "gzip",
            "ETag": "hashValue",
        });
    });

    it("Test the header generation without gzip", () => {
        const header = proxyquire("../src/buildHeader", mockConfiguration)("text/html", false, "hashValue");

        expect(header).toEqual({
            "test": "123",
            "Content-Type": "text/html",
            "ETag": "hashValue",
        });
    });
});
