const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const minifySvg = proxyquire("../src/minifySvg", mockConfiguration);

describe("minifySvg", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Minify pure svg", () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <!-- Test comment -->
            <metadata>Test metadata</metadata>
            <rect width="24" height="24" fill="#000000"></rect>
            <path d="M 10 10 L 20 20"></path>
        </svg>`;

        const fileHash = "svgHash1";

        const outputSvg = minifySvg(inputSvg, fileHash);

        expect(outputSvg).not.toContain("Test comment");
        expect(outputSvg).not.toContain("metadata");
        expect(outputSvg).not.toContain("  ");
        expect(outputSvg).not.toMatch(/>\s+</);
        expect(outputSvg).not.toContain("<rect");
        expect(outputSvg).toContain("<path");
        expect(outputSvg).toContain("l10 10");
    });

    it("Does not minify a badly formatted svg file", () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M 10 10 L 20 20">
        </svg>`;

        const fileHash = "svgHash2";

        expect(minifySvg(inputSvg, fileHash)).toEqual(inputSvg);
    });

    it("Test cache", () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <!-- Test comment -->
            <path d="M 10 10 L 20 20"></path>
        </svg>`;

        const fileHash = "svgHash3";

        // Processing
        expect(minifySvg(inputSvg, fileHash)).not.toContain("Test comment");

        // Cache
        expect(minifySvg(inputSvg, fileHash)).not.toContain("Test comment");

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}.svg`, "test");
        expect(minifySvg(inputSvg, fileHash)).toEqual("test");
    });
});