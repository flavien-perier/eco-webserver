const fs = require("fs");
const { join } = require("path");
const { randomUUID } = require("crypto");
const sharp = require("sharp");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = join("/tmp/opencode", `eco-webserver-transformations-${process.pid}-${randomUUID()}`);

const mockConfiguration = {
    "./configuration.ts": {
        default: {
            cacheDir: TEST_CACHE,
            logDir: join(TEST_CACHE, "server.log")
        },
        "@global": true
    }
};

const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const sharedProcessingCache = { ...processingCache, "@global": true };
const loadTransformation = modulePath => proxyquire(modulePath, {
    ...mockConfiguration,
    "./processingCache.ts": sharedProcessingCache
});

const minifyHtml = loadTransformation("../src/minifyHtml.ts");
const minifyCss = loadTransformation("../src/minifyCss.ts");
const minifyJs = loadTransformation("../src/minifyJs.ts");
const minifyJson = loadTransformation("../src/minifyJson.ts");
const minifySvg = loadTransformation("../src/minifySvg.ts");
const minifyXml = loadTransformation("../src/minifyXml.ts");
const convertImage = loadTransformation("../src/convertImage.ts");
const convertFont = loadTransformation("../src/convertFont.ts");

describe("transformation edge cases", () => {
    beforeEach(() => {
        fs.mkdirSync(TEST_CACHE, { recursive: true });
    });

    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    describe("HTML", () => {
        it("accepts an empty document", async () => {
            expect(await minifyHtml("", "edge-html-empty")).toBe("");
        });

        it("removes a whitespace-only document", async () => {
            expect(await minifyHtml(" \n\t  \r\n ", "edge-html-whitespace")).toBe("");
        });

        it("preserves multibyte text and attribute values", async () => {
            const output = await minifyHtml(
                '<html lang="fr"><body><p title="Grüße 世界"> café 🌍 𝄞 </p></body></html>',
                "edge-html-unicode"
            );

            expect(output).toContain("Grüße 世界");
            expect(output).toContain("café 🌍 𝄞");
        });

        it("keeps nested template assets and comment-like strings intact", async () => {
            const input = `<html><body><!-- remove --><template>
                <div data-label="é🌍">contenu</div>
                <style>.icon::after { content: "<b>/* keep */</b>"; }</style>
                <script>const markup = "<div><!-- keep --></div>";</script>
            </template></body></html>`;
            const output = await minifyHtml(input, "edge-html-nested-assets");

            expect(output).toContain("<template>");
            expect(output).toContain("é🌍");
            expect(output).toContain(".icon::after");
            expect(output).toContain("keep");
            expect(output).not.toContain("remove");
        });

        it("does not crash on truncated and malformed nested markup", async () => {
            const output = await minifyHtml(
                '<div data-value="unterminated><template><span>é🌍',
                "edge-html-malformed"
            );

            expect(typeof output).toBe("string");
            expect(output).toContain("é🌍");
        });
    });

    describe("CSS", () => {
        it("accepts empty and whitespace-only stylesheets", async () => {
            expect(await minifyCss("", "edge-css-empty")).toBe("");
            expect(await minifyCss(" \n\t  ", "edge-css-whitespace")).toBe("");
        });

        it("preserves unicode and comment markers inside escaped strings", async () => {
            const input = `.icon::after {
                /* remove */
                content: "é🌍 /* keep */ \\" Guillemets \\"";
            }`;
            const output = await minifyCss(input, "edge-css-unicode-strings");

            expect(output).toContain("é🌍 /* keep */");
            expect(output).toContain("Guillemets");
            expect(output).not.toContain("remove");
        });

        it("does not crash on a truncated string and block", async () => {
            const input = '.broken { content: "unterminated\n }';
            const output = await minifyCss(input, "edge-css-truncated");

            expect(typeof output).toBe("string");
            expect(output).toContain("unterminated");
        });
    });

    describe("JavaScript", () => {
        it("accepts empty and whitespace-only sources", async () => {
            expect(await minifyJs("", "edge-js-empty")).toBe("");
            expect(await minifyJs(" \n\t  ", "edge-js-whitespace")).toBe("");
        });

        it("preserves executable unicode and comment-like strings", async () => {
            const input = `(() => {
                const text = "é🌍 // keep /* keep */";
                const template = \`Grüße 世界\`;
                return [text, template, "// keep".length].join("|");
            })();`;
            const output = await minifyJs(input, "edge-js-unicode-strings");

            expect(new Function(`return ${output}`)()).toBe("é🌍 // keep /* keep */|Grüße 世界|7");
        });

        it("returns a truncated source unchanged", async () => {
            const input = 'const value = "unterminated';
            expect(await minifyJs(input, "edge-js-truncated")).toBe(input);
        });
    });

    describe("JSON", () => {
        it("returns empty and whitespace-only inputs unchanged", async () => {
            expect(await minifyJson("", "edge-json-empty")).toBe("");
            expect(await minifyJson(" \n\t  ", "edge-json-whitespace")).toBe(" \n\t  ");
        });

        it("minifies boundary numbers without losing strings", async () => {
            const input = `{
                "nil": null,
                "negativeZero": -0,
                "minimum": 5e-324,
                "maximum": 1.7976931348623157e+308,
                "safeInteger": 9007199254740991,
                "text": "é🌍 // keep /* keep */ { [ ] }"
            }`;
            const output = await minifyJson(input, "edge-json-boundaries");

            expect(output).toBe(JSON.stringify(JSON.parse(input)));
            expect(JSON.parse(output).minimum).toBe(Number.MIN_VALUE);
            expect(JSON.parse(output).maximum).toBe(Number.MAX_VALUE);
            expect(JSON.parse(output).text).toBe("é🌍 // keep /* keep */ { [ ] }");
        });

        it("returns truncated JSON unchanged", async () => {
            const input = '{"items":[1,2,{"label":"é🌍"}';
            expect(await minifyJson(input, "edge-json-truncated")).toBe(input);
        });
    });

    describe("SVG", () => {
        it("accepts empty and whitespace-only documents", async () => {
            expect(await minifySvg("", "edge-svg-empty")).toBe("");
            expect(await minifySvg(" \n\t  ", "edge-svg-whitespace")).toBe("");
        });

        it("retains the viewBox, complex path and multibyte text", async () => {
            const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
                <!-- remove -->
                <path d="M 0.5 1.25 C 10 20 30 40 49.5 49.75 A 5 5 0 0 1 75 25 L 100 0 Z"/>
                <text x="2" y="10">é🌍</text>
            </svg>`;
            const output = await minifySvg(input, "edge-svg-viewbox-path");

            expect(output).toContain('viewBox="0 0 100 50"');
            expect(output).toContain("<path");
            expect(output).toMatch(/<path[^>]*\sd="/);
            expect(output).toContain("é🌍");
            expect(output).not.toContain("remove");
        });

        it("returns a truncated document unchanged", async () => {
            const input = '<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L1 1"';
            expect(await minifySvg(input, "edge-svg-truncated")).toBe(input);
        });
    });

    describe("XML", () => {
        it("accepts empty and whitespace-only documents", async () => {
            expect(await minifyXml("", "edge-xml-empty")).toBe("");
            expect(await minifyXml(" \n\t  ", "edge-xml-whitespace")).toBe("");
        });

        it("removes comments without altering CDATA contents", async () => {
            const input = `<root>
                <!-- remove -->
                <![CDATA[ <!-- keep --> <tag> & é🌍 ]]>
                <value>42</value>
            </root>`;
            const output = await minifyXml(input, "edge-xml-cdata-comments");

            expect(output).toBe("<root><![CDATA[ <!-- keep --> <tag> & é🌍 ]]><value>42</value></root>");
        });

        it("preserves large CDATA sections when processed in a worker", async () => {
            const input = `<root><![CDATA[  <!-- keep -->\n${"x".repeat(70 * 1024)}  ]]></root>`;
            expect(await minifyXml(input, "edge-xml-worker-cdata")).toBe(input);
        });

        it("does not crash on truncated XML", async () => {
            const input = "<root><value>é🌍";
            expect(await minifyXml(input, "edge-xml-truncated")).toBe(input);
        });
    });

    describe("images", () => {
        it("converts a generated one-pixel PNG", async () => {
            const png = await sharp({
                create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } }
            }).png().toBuffer();
            const webp = await convertImage(png, "edge-image-one-pixel");
            const metadata = await sharp(webp).metadata();

            expect(metadata.format).toBe("webp");
            expect(metadata.width).toBe(1);
            expect(metadata.height).toBe(1);
        });

        it("retains an alpha channel", async () => {
            const pixels = Buffer.from([255, 0, 0, 0, 0, 0, 255, 128]);
            const png = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
            const webp = await convertImage(png, "edge-image-alpha");
            const metadata = await sharp(webp).metadata();

            expect(metadata.format).toBe("webp");
            expect(metadata.hasAlpha).toBeTrue();
        });

        it("converts a generated grayscale image", async () => {
            const pixels = Buffer.from([0, 127, 255, 64]);
            const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 1 } })
                .toColourspace("b-w")
                .png()
                .toBuffer();
            expect((await sharp(png).metadata()).space).toBe("b-w");

            const webp = await convertImage(png, "edge-image-grayscale");
            const metadata = await sharp(webp).metadata();

            expect(metadata.format).toBe("webp");
            expect(metadata.width).toBe(2);
            expect(metadata.height).toBe(2);
        });

        it("accepts a generated animated GIF", async () => {
            const frames = Buffer.alloc(2 * 4 * 4 * 2);
            for (let index = 0; index < 16; index += 4) {
                frames[index] = 255;
                frames[index + 3] = 255;
            }
            for (let index = 16; index < frames.length; index += 4) {
                frames[index + 1] = 255;
                frames[index + 3] = 255;
            }
            const gif = await sharp(frames, {
                raw: { width: 2, height: 4, channels: 4, pageHeight: 2 }
            }).gif().toBuffer();
            expect((await sharp(gif).metadata()).pages).toBe(2);

            const webp = await convertImage(gif, "edge-image-animated-gif");
            expect((await sharp(webp).metadata()).format).toBe("webp");
        });

        it("rejects empty, truncated and random images without altering them", async () => {
            const png = await sharp({
                create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } }
            }).png().toBuffer();
            const inputs = [
                Buffer.alloc(0),
                png.subarray(0, Math.floor(png.length / 3)),
                Buffer.from([0, 255, 1, 254, 2, 253, 3, 252, 128, 127])
            ];

            for (let index = 0; index < inputs.length; index++) {
                const input = inputs[index];
                const original = Buffer.from(input);
                expect(await convertImage(input, `edge-image-invalid-${index}`)).toBeNull();
                expect(input).toEqual(original);
            }
        });
    });

    describe("fonts", () => {
        it("rejects empty, truncated and random fonts", async () => {
            const font = fs.readFileSync("./tests/testDist/simple/test.otf");
            const inputs = [
                Buffer.alloc(0),
                font.subarray(0, 24),
                Buffer.from([0, 255, 1, 254, 2, 253, 3, 252, 128, 127])
            ];

            for (let index = 0; index < inputs.length; index++) {
                expect(await convertFont(inputs[index], `edge-font-invalid-${index}`)).toBeNull();
            }
        });

        it("keeps disk cache entries with different hashes independent", async () => {
            const font = fs.readFileSync("./tests/testDist/simple/test.otf");
            const firstHash = "edge-font-cache-a";
            const secondHash = "edge-font-cache-b";
            const first = await convertFont(font, firstHash);
            const second = await convertFont(font, secondHash);
            await processingCache.flushProcessingCache();

            expect(first.subarray(0, 4).toString()).toBe("wOF2");
            expect(second).toEqual(first);
            expect(fs.existsSync(join(TEST_CACHE, `v2-${firstHash}.woff2`))).toBeTrue();
            expect(fs.existsSync(join(TEST_CACHE, `v2-${secondHash}.woff2`))).toBeTrue();

            fs.writeFileSync(join(TEST_CACHE, `v2-${firstHash}.woff2`), "cached-a");
            expect(await convertFont(font, firstHash)).toEqual(Buffer.from("cached-a"));
            expect(await convertFont(font, secondHash)).toEqual(second);
        });
    });
});
