const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.ts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const minifyHtml = proxyquire("../src/minifyHtml.ts", {
    ...mockConfiguration,
    "./processingCache.ts": { ...processingCache, "@global": true }
});

describe("minifyHtml", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify pure html", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2" param="key=value">test</p><br class = ""/>
        </html>`;

        const fileHash = "htmlHash1";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Minify html with css", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test</p><br class = ""/>
            <style type="text/css">
                a:hover {
                    border-radius : 1px;
                    border: 1px solid #000;
                }

                /* Test comment */
                .test {
                    background-color : blue;
                }
            </style>
        </html>`;

        const fileHash = "htmlHash2";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<style>a:hover{border-radius:1px;border:1px solid #000}.test{background-color:#00f}</style></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Minify html with js", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test</p><br class = ""/>
            <script type="text/javascript" charset="utf-8" async>
                function test() {
                    if ( yes === 3 ) {
                        return {
                            a : 4,
                            "b": "test",
                            c: [4, 
                                5,
                                "(a == 3)"
                            ]
                        };
                    }
                }
            </script>
        </html>`;

        const fileHash = "htmlHash3";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<script type=text/javascript charset=utf-8 async>function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}</script></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Preserves comment-like text inside scripts", async () => {
        const output = await minifyHtml('<html><body><script>const marker = "<!-- keep -->";</script></body></html>', "htmlStringHash");
        expect(output).toContain("\\x3c!-- keep --\\x3e");
    });

    it("Minifies large documents and inline assets in a worker", async () => {
        const inputHtml = `<html><head><style>.test { color: red; }</style></head><body><div>${"x".repeat(70 * 1024)}</div><script>console.log("remove"); const value = 1;</script></body></html>`;
        const output = await minifyHtml(inputHtml, "htmlLargeHash");

        expect(output).toContain(".test{color:red}");
        expect(output).toContain("const value=1");
        expect(output).not.toContain("console.log");
    });

    it("Test cache", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2" param="key=value">test</p><br class = ""/>
        </html>`;

        const fileHash = "htmlHash4";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        // Processing
        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);

        // Cache
        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.html`, "test");
        expect(await minifyHtml(inputHtml, fileHash)).toEqual("test");
    });
});
