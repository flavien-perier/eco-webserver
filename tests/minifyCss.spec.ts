const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.ts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const minifyCss = proxyquire("../src/minifyCss.ts", {
    ...mockConfiguration,
    "./processingCache.ts": processingCache
});

describe("minifyCss", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify pure css", async () => {
        const inputCss = `a:hover {
            border-radius : 1px;
            border: 1px solid #000;
        }
        
        /* Test comment */
        .test {
            background-color : blue;
        }`;

        const fileHash = "cssHash1";

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:#00f}";

        expect(await minifyCss(inputCss, fileHash)).toEqual(expectedCss);
    });

    it("Preserves comment-like text inside strings", async () => {
        const output = await minifyCss('.test::after { content: "/* keep */ : { }"; }', "cssStringHash");
        expect(output).toContain("/* keep */ : { }");
    });

    it("Test cache", async () => {
        const inputCss = `a:hover {
            border-radius : 1px;
            border: 1px solid #000;
        }
        
        /* Test comment */
        .test {
            background-color : blue;
        }`;

        const fileHash = "cssHash2";

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:#00f}";

        // Processing
        expect(await minifyCss(inputCss, fileHash)).toEqual(expectedCss);

        // Cache
        expect(await minifyCss(inputCss, fileHash)).toEqual(expectedCss);

        // Modify cache file and read it
        
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.css`, "test");
        expect(await minifyCss(inputCss, fileHash)).toEqual("test");
    });
});
