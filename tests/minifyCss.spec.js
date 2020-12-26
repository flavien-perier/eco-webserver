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

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}";

        expect(minifyCss(inputCss)).toEqual(expectedCss);
    });
});
