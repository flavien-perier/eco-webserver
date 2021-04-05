const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const minifyCss = proxyquire("../src/minifyCss", mockConfiguration);

describe("minifyCss", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Minify pure css", () => {
        const inputCss = `a:hover {
            border-radius : 1px;
            border: 1px solid #000;
        }
        
        /* Test comment */
        .test {
            background-color : blue;
        }`;

        const fileHash = "cssHash1";

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}";

        expect(minifyCss(inputCss, fileHash)).toEqual(expectedCss);
    });

    it("Test cache", () => {
        const inputCss = `a:hover {
            border-radius : 1px;
            border: 1px solid #000;
        }
        
        /* Test comment */
        .test {
            background-color : blue;
        }`;

        const fileHash = "cssHash2";

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}";

        // Processing
        expect(minifyCss(inputCss, fileHash)).toEqual(expectedCss);

        // Cache
        expect(minifyCss(inputCss, fileHash)).toEqual(expectedCss);

        // Modify cache file and read it
        
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}.css`, "test");
        expect(minifyCss(inputCss, fileHash)).toEqual("test");
    });
});
