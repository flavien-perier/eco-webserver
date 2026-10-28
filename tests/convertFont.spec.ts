const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.ts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const convertFont = proxyquire("../src/convertFont.ts", {
    ...mockConfiguration,
    "./processingCache.ts": processingCache
});

describe("convertFont", () => {
    beforeEach(() => {
        fs.mkdirSync(TEST_CACHE, { recursive: true });
    });

    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Converts a font into woff2", async () => {
        const otf = fs.readFileSync("./tests/testDist/simple/test.otf");

        const woff2 = await convertFont(otf, "fontHash1");

        expect(woff2).not.toBeNull();
        expect(woff2.subarray(0, 4).toString()).toEqual("wOF2");
        expect(woff2.length < otf.length).toBeTrue();
    });

    it("Does not convert a badly formatted font", async () => {
        const brokenFont = Buffer.from("this is not a font");

        expect(await convertFont(brokenFont, "fontHash2")).toBeNull();
    });

    it("Test cache", async () => {
        const otf = fs.readFileSync("./tests/testDist/simple/test.otf");

        const fileHash = "fontHash3";

        // Processing
        const woff2 = await convertFont(otf, fileHash);
        expect(woff2.subarray(0, 4).toString()).toEqual("wOF2");

        // Cache
        expect(await convertFont(otf, fileHash)).toEqual(woff2);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.woff2`, "test");
        expect(await convertFont(otf, fileHash)).toEqual(Buffer.from("test"));
    });
});