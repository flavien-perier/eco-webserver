const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache.cts", mockConfiguration);
const minifyJson = proxyquire("../src/minifyJson.cts", {
    ...mockConfiguration,
    "./processingCache.cts": processingCache
});

describe("minifyJson", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify json file", async () => {
        const inputJson = `{
            "number": 3.22,
            "string": "hello world {1, 2, 3}",
            "table": [ 
                1, 2, 3, 
                4, 5, 6
            ],
            "object": {
                "key": "value"
            }
        }`;

        const fileHash = "jsonHash1";

        const expectedJson = '{"number":3.22,"string":"hello world {1, 2, 3}","table":[1,2,3,4,5,6],"object":{"key":"value"}}';

        expect(await minifyJson(inputJson, fileHash)).toEqual(expectedJson);
    });

    it("Does not minify a badly formatted json file", async () => {
        const inputJson = `{
            "key": "value"
        }{"other-key": "value"}`;

        const fileHash = "jsonHash2";

        expect(await minifyJson(inputJson, fileHash)).toEqual(inputJson);
    });

    it("Test cache", async () => {
        const inputJson = `{
            "number": 3.22,
            "string": "hello world {1, 2, 3}",
            "table": [ 
                1, 2, 3, 
                4, 5, 6
            ],
            "object": {
                "key": "value"
            }
        }`;

        const fileHash = "jsonHash3";

        const expectedJson = '{"number":3.22,"string":"hello world {1, 2, 3}","table":[1,2,3,4,5,6],"object":{"key":"value"}}';

        // Processing
        expect(await minifyJson(inputJson, fileHash)).toEqual(expectedJson);

        // Cache
        expect(await minifyJson(inputJson, fileHash)).toEqual(expectedJson);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.json`, "test");
        expect(await minifyJson(inputJson, fileHash)).toEqual("test");
    });
});
