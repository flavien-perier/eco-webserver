const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.ts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const minifyXml = proxyquire("../src/minifyXml.ts", {
    ...mockConfiguration,
    "./processingCache.ts": processingCache
});

describe("minifyXml", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify pure xml", async () => {
        const inputXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <!-- Test comment -->
            <url>
                <loc>https://example.com</loc>
                <lastmod>2023-01-01</lastmod>
            </url>
        </urlset>`;

        const fileHash = "xmlHash1";

        const expectedXml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com</loc><lastmod>2023-01-01</lastmod></url></urlset>`;

        expect(await minifyXml(inputXml, fileHash)).toEqual(expectedXml);
    });

    it("Keeps the text content spaces", async () => {
        const inputXml = `<root>
            <description>first line
            second line</description>
        </root>`;

        const fileHash = "xmlHash2";

        expect(await minifyXml(inputXml, fileHash)).toEqual(`<root><description>first line
            second line</description></root>`);
    });

    it("Preserves spaces in text content and attributes", async () => {
        const inputXml = `<root><description title="first  second">  first  second
            third  </description></root>`;

        expect(await minifyXml(inputXml, "xmlHashSpaces")).toEqual(inputXml);
    });

    it("Respects xml:space preserve and default", async () => {
        const inputXml = `<root xml:space="preserve">
            <description>  first  second  </description>
            <group xml:space="default">
                <value>42</value>
            </group>
        </root>`;
        const expectedXml = `<root xml:space="preserve">
            <description>  first  second  </description>
            <group xml:space="default"><value>42</value></group>
        </root>`;

        expect(await minifyXml(inputXml, "xmlHashXmlSpace")).toEqual(expectedXml);
    });

    it("Does not confuse literal elements with CDATA placeholders", async () => {
        const inputXml = `<root><eco-cdata-0/><![CDATA[  <tag>  value  </tag>  ]]><eco-cdata-1/></root>`;

        expect(await minifyXml(inputXml, "xmlHashCdataCollision")).toEqual(inputXml);
        expect(await minifyXml(`<root><eco-cdata-0/></root>`, "xmlHashCdataElement")).toEqual(`<root><eco-cdata-0/></root>`);
    });

    it("Removes comments and preserves CDATA byte for byte", async () => {
        const inputXml = `<root><!-- remove --><![CDATA[ <!-- keep -->
            <tag>  value  </tag> ]]><!-- remove --></root>`;
        const expectedXml = `<root><![CDATA[ <!-- keep -->
            <tag>  value  </tag> ]]></root>`;

        expect(await minifyXml(inputXml, "xmlHashCommentsCdata")).toEqual(expectedXml);
    });

    it("Test cache", async () => {
        const inputXml = `<root>
            <!-- Test comment -->
            <value>42</value>
        </root>`;

        const fileHash = "xmlHash3";

        // Processing
        expect(await minifyXml(inputXml, fileHash)).not.toContain("Test comment");

        // Cache
        expect(await minifyXml(inputXml, fileHash)).not.toContain("Test comment");

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}-v2.xml`, "test");
        expect(await minifyXml(inputXml, fileHash)).toEqual("test");
    });
});