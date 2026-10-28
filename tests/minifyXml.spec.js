const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const minifyXml = proxyquire("../src/minifyXml.cts", mockConfiguration);

describe("minifyXml", () => {
    afterEach(() => {
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

        expect(await minifyXml(inputXml, fileHash)).toEqual(`<root><description>first line second line</description></root>`);
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
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.xml`, "test");
        expect(await minifyXml(inputXml, fileHash)).toEqual("test");
    });
});