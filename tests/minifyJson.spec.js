const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const minifyJson = proxyquire("../src/minifyJson", mockConfiguration);

describe("minifyJson", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Minify json file", () => {
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

        const expectedJson = '{"number":3.22,"string":"hello world {1, 2, 3}","table":[1,2,3,4,5,6],"object":{"key":"value"}}';

        expect(minifyJson(inputJson)).toEqual(expectedJson);
    });

    it("Does not minify a badly formatted json file", () => {
        const inputJson = `{
            "key": "value"
        }{"other-key": "value"}`;

        expect(minifyJson(inputJson)).toEqual(inputJson);
    });
});
