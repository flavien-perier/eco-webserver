const proxyquire = require("proxyquire").noPreserveCache();

describe("getContentType", () => {
    const mockConfiguration = {
        "./configuration": {
            default: {
                port: 8080,
                cacheCycle: 1800,
                distDir: "./tests/testDist/simple",
                logDir: "/dev/null",
                enableIsomorphic: false,
                header: {},
                contentType: {
                    "text": "text/plain",
                    "binary": "application/octet-stream",
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

    it("No extension", () => {
        expect(proxyquire("../src/getContentType", mockConfiguration)("https://www.flavien.io/home")).toEqual("text/html");
    });

    it("Known extension", () => {
        expect(proxyquire("../src/getContentType", mockConfiguration)("https://www.flavien.io/style.css")).toEqual("text/css");
    });

    it("Unknown extension", () => {
        expect(proxyquire("../src/getContentType", mockConfiguration)("https://www.flavien.io/content.md")).toEqual("text/plain");
    });
});