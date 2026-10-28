const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const minifySvg = proxyquire("../src/minifySvg.cts", mockConfiguration);

describe("minifySvg", () => {
    afterEach(() => {
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify pure svg", async () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <!-- Test comment -->
            <metadata>Test metadata</metadata>
            <rect width="24" height="24" fill="#000000"></rect>
            <path d="M 10 10 L 20 20"></path>
        </svg>`;

        const fileHash = "svgHash1";

        const outputSvg = await minifySvg(inputSvg, fileHash);

        expect(outputSvg).not.toContain("Test comment");
        expect(outputSvg).not.toContain("metadata");
        expect(outputSvg).not.toContain("  ");
        expect(outputSvg).not.toMatch(/>\s+</);
        expect(outputSvg).not.toContain("<rect");
        expect(outputSvg).toContain("<path");
        expect(outputSvg).toContain("l10 10");
    });

    it("Does not minify a badly formatted svg file", async () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M 10 10 L 20 20">
        </svg>`;

        const fileHash = "svgHash2";

        expect(await minifySvg(inputSvg, fileHash)).toEqual(inputSvg);
    });

    it("Test cache", async () => {
        const inputSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <!-- Test comment -->
            <path d="M 10 10 L 20 20"></path>
        </svg>`;

        const fileHash = "svgHash3";

        // Processing
        expect(await minifySvg(inputSvg, fileHash)).not.toContain("Test comment");

        // Cache
        expect(await minifySvg(inputSvg, fileHash)).not.toContain("Test comment");

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.svg`, "test");
        expect(await minifySvg(inputSvg, fileHash)).toEqual("test");
    });
});