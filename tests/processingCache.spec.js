const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache.cts", mockConfiguration);

describe("processingCache", () => {
    afterEach(() => {
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Caches a process and recovers the value", async () => {
        const afterProcessing = "Result after work";
        const hash = "processingCacheHash";

        expect(await processingCache.readProcessingCache(hash, "js")).toBeNull();

        await processingCache.writeProcessingCache(afterProcessing, hash, "js");

        expect((await processingCache.readProcessingCache(hash, "js")).toString()).toEqual(afterProcessing);
        expect(fs.readdirSync(TEST_CACHE)).toEqual([`v2-${hash}.js`]);
    });

    it("Evicts the oldest artefacts above the configured size", async () => {
        await processingCache.writeProcessingCache("old cache contents", "old", "js");
        await processingCache.writeProcessingCache("new", "new", "js");
        const oldPath = `${TEST_CACHE}/v2-old.js`;
        const oldDate = new Date(Date.now() - 60000);
        fs.utimesSync(oldPath, oldDate, oldDate);

        await processingCache.cleanProcessingCache(3);

        expect(fs.existsSync(oldPath)).toBeFalse();
        expect(fs.existsSync(`${TEST_CACHE}/v2-new.js`)).toBeTrue();
    });
});
