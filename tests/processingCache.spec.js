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
        const inputProcess = "File content";

        const outputProcess = "Result after work";

        // Test if the data is in the cache
        expect(processingCache.readProcessingCache(inputProcess, "js")).toBeNull();

        // Put the data in the cache
        processingCache.writeProcessingCache(inputProcess, outputProcess, "js");

        // Retrieve the data
        expect(processingCache.readProcessingCache(inputProcess, "js").toString()).toEqual(outputProcess);
    });
});
