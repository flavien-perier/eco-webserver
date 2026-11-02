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
            + "<script async>function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}</script></html>";

        expect(await minifyHtml(inputHtml, fileHash)).toEqual(expectedHtml);
    });

    it("Removes only redundant script types", async () => {
        const inputHtml = '<script type="text/javascript">window.example = 1;</script>'
            + '<script type="module">export default 1;</script>'
            + '<script type="importmap">{"imports":{}}</script>'
            + '<script type="application/ld+json">{}</script>';
        const outputHtml = await minifyHtml(inputHtml, "htmlScriptTypesHash");

        expect(outputHtml).toContain("<script>window.example=1;</script>");
        expect(outputHtml).toContain('<script type=module>');
        expect(outputHtml).toContain('<script type=importmap>');
        expect(outputHtml).toContain('<script type=application/ld+json>');
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

    for (const [mode, padding] of [["locally", ""], ["in a worker", "x".repeat(70 * 1024)]]) {
        it(`Keeps style attributes and media queries when minifying ${mode}`, async () => {
            const inputHtml = `<html><head><link rel="stylesheet" href="a.css" media="screen and (max-width: 600px)">`
                + `<style media="print">p { color: red; }</style></head>`
                + `<body><div style="color: red; margin: 0px">${padding}</div></body></html>`;
            const output = await minifyHtml(inputHtml, `htmlInlineCss-${mode}`);

            expect(output).toContain("<div style=color:red;margin:0>");
            expect(output).toContain('media="screen and (max-width:600px)"');
            expect(output).toContain("media=print");
            expect(output).toContain("p{color:red}");
        });

        it(`Minifies event handlers with bare returns ${mode}`, async () => {
            const inputHtml = `<html><body><!-- remove -->\n    <button onclick="doIt();   return false;">Go</button>`
                + `<script type="module">import value from "./value.js"; console.log(value);</script>`
                + `<p>${padding}</p></body></html>`;
            const output = await minifyHtml(inputHtml, `htmlInlineJs-${mode}`);

            expect(output).not.toContain("remove");
            expect(output).toContain("onclick=\"return doIt(),!1;\"");
            expect(output).toContain('import value from"./value.js"');
        });
    }

    it("Serves but never persists the original page when minification fails", async () => {
        const failingMinifyHtml = proxyquire("../src/minifyHtml.ts", {
            ...mockConfiguration,
            "./processingCache.ts": { ...processingCache, "@global": true },
            "./cpuPool.ts": { runCpuTask: async () => { throw new Error("CPU worker exited with code 1"); } },
        });

        expect(await failingMinifyHtml("<p>  raw  </p>", "htmlFailureHash")).toBe("<p>  raw  </p>");
        await processingCache.flushProcessingCache();
        expect(fs.existsSync(`${TEST_CACHE}/htmlFailureHash-v3.html`)).toBeFalse();
    });

    it("Propagates a saturated CPU queue instead of caching the original page", async () => {
        const saturated: any = new Error("CPU worker queue is full");
        saturated.statusCode = 503;
        const saturatedMinifyHtml = proxyquire("../src/minifyHtml.ts", {
            ...mockConfiguration,
            "./processingCache.ts": { ...processingCache, "@global": true },
            "./cpuPool.ts": { runCpuTask: async () => { throw saturated; } },
        });

        await expectAsync(saturatedMinifyHtml("<p>raw</p>", "htmlSaturatedHash")).toBeRejectedWith(saturated);
        await processingCache.flushProcessingCache();
        expect(fs.existsSync(`${TEST_CACHE}/htmlSaturatedHash-v3.html`)).toBeFalse();
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
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}-v3.html`, "test");
        expect(await minifyHtml(inputHtml, fileHash)).toEqual("test");
    });
});
