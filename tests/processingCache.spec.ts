const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache.cts", mockConfiguration);

describe("processingCache", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Caches a process and recovers the value", async () => {
        const afterProcessing = "Result after work";
        const hash = "processingCacheHash";

        expect(await processingCache.readProcessingCache(hash, "js")).toBeNull();

        await processingCache.writeProcessingCache(afterProcessing, hash, "js");
        await processingCache.flushProcessingCache();

        expect((await processingCache.readProcessingCache(hash, "js")).toString()).toEqual(afterProcessing);
        expect(fs.readdirSync(TEST_CACHE)).toEqual([`v2-${hash}.js`]);
    });

    it("Evicts the oldest artefacts above the configured size", async () => {
        await processingCache.writeProcessingCache("old cache contents", "old", "js");
        await processingCache.writeProcessingCache("new", "new", "js");
        await processingCache.flushProcessingCache();
        const oldPath = `${TEST_CACHE}/v2-old.js`;
        const oldDate = new Date(Date.now() - 60000);
        fs.utimesSync(oldPath, oldDate, oldDate);

        await processingCache.cleanProcessingCache(3);

        expect(fs.existsSync(oldPath)).toBeFalse();
        expect(fs.existsSync(`${TEST_CACHE}/v2-new.js`)).toBeTrue();
    });

    it("Returns without waiting for a slow disk write", async () => {
        let releaseWrite;
        const slowWrite = new Promise(resolve => {
            releaseWrite = resolve;
        });
        const realWriteFile = fs.promises.writeFile;
        const slowProcessingCache = proxyquire("../src/processingCache.cts", {
            ...mockConfiguration,
            "fs/promises": {
                ...fs.promises,
                writeFile: async (...args) => {
                    await slowWrite;
                    return realWriteFile(...args);
                }
            }
        });

        let returned = false;
        const writePromise = slowProcessingCache.writeProcessingCache("slow", "slow", "js")
            .then(() => {
                returned = true;
            });

        try {
            await new Promise(resolve => setImmediate(resolve));
            expect(returned).toBeTrue();
        } finally {
            releaseWrite();
        }

        await writePromise;
        await slowProcessingCache.flushProcessingCache();
        expect((await slowProcessingCache.readProcessingCache("slow", "js")).toString()).toEqual("slow");
    });
});
