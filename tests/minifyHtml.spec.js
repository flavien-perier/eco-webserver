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

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        expect(await minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Minify html with css", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
            <style>
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

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<style>a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}</style></html>";

        expect(await minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Minify html with js", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
            <script>
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

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<script>function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}</script></html>";

        expect(await minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Test cache", async () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2" param="key=value">test< / p><br class = ""/ >
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\" param=\"key=value\">test</p><br/></html>";

        // Processing
        expect(await minifyHtml(inputHtml)).toEqual(expectedHtml);

        // Cache
        expect(await minifyHtml(inputHtml)).toEqual(expectedHtml);

        // Modify cache file and read it
        fs.writeFileSync(TEST_CACHE + "/f837f253107bf544137890cba56cd6e0a6abd3af1ce37c2cb448bea54a149efa.html", "test");
        expect(await minifyHtml(inputHtml)).toEqual("test");
    });
});
