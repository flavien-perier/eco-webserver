const proxyquire = require("proxyquire").noPreserveCache();
const buildHeader = require("../src/buildHeader");

describe("buildHeader", () => {
    const mockConfiguration = {
        "./configuration": {
            default: {
                header: {
                    "test": "123",
                },
            },
            "@global": true,
        }
    };

    it("Test the header generation with gzip", () => {
        const header = proxyquire("../src/buildHeader", mockConfiguration)("text/html", "gzip", "hashValue");

        expect(header).toEqual({
            "test": "123",
            "Content-Type": "text/html",
            "Content-Encoding": "gzip",
            "ETag": "hashValue",
        });
    });

    it("Test the header generation with brotli", () => {
        const header = proxyquire("../src/buildHeader", mockConfiguration)("text/html", "br", "hashValue");

        expect(header).toEqual({
            "test": "123",
            "Content-Type": "text/html",
            "Content-Encoding": "br",
            "ETag": "hashValue",
        });
    });

    it("Test the header generation without compression", () => {
        const header = proxyquire("../src/buildHeader", mockConfiguration)("text/html", false, "hashValue");

        expect(header).toEqual({
            "test": "123",
            "Content-Type": "text/html",
            "ETag": "hashValue",
        });
    });
});
