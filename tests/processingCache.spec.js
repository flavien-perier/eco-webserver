const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache", mockConfiguration);

describe("processingCache", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Cache a process and recover the value", () => {
        const afterProcessing = "Result after work";
        const hash = "processingCacheHash";

        // Test if the data is in the cache
        expect(processingCache.readProcessingCache(hash, "js")).toBeNull();

        // Put the data in the cache
        processingCache.writeProcessingCache(afterProcessing, hash, "js");

        // Retrieve the data
        expect(processingCache.readProcessingCache(hash, "js").toString()).toEqual(afterProcessing);
    });
});
