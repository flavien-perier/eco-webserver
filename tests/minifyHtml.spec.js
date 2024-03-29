const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const minifyHtml = proxyquire("../src/minifyHtml", mockConfiguration);

describe("minifyHtml", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Minify pure html", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2" param="key=value">test< / p><br class = ""/ >
        < / html>`;

        const fileHash = "htmlHash1";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Minify html with css", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
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
        < / html>`;

        const fileHash = "htmlHash2";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<style>a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}</style></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Minify html with js", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
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
        < / html>`;

        const fileHash = "htmlHash3";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<script type=text/javascript async>function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}</script></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Test cache", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2" param="key=value">test< / p><br class = ""/ >
        < / html>`;

        const fileHash = "htmlHash4";

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        // Processing
        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);

        // Cache
        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}.html`, "test");
        expect(await minifyHtml(inputHtml, fileHash)).toEqual("test");
    });
});
