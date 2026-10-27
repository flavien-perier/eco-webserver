const fs = require("fs");
const sharp = require("sharp");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.cts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};
const convertImage = proxyquire("../src/convertImage.cts", mockConfiguration);

describe("convertImage", () => {
    beforeEach(() => {
        fs.mkdirSync(TEST_CACHE);
    });

    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
    });

    it("Converts an image into webp", async () => {
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();

        const webp = await convertImage(png, "imageHash1");

        expect(webp).not.toBeNull();
        expect(webp.subarray(0, 4).toString()).toEqual("RIFF");
        expect(webp.subarray(8, 12).toString()).toEqual("WEBP");
        expect(await sharp(webp).metadata().then(meta => meta.format)).toEqual("webp");
    });

    it("Does not convert a badly formatted image", async () => {
        const brokenImage = Buffer.from("this is not an image");

        expect(await convertImage(brokenImage, "imageHash2")).toBeNull();
    });

    it("Test cache", async () => {
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toBuffer();

        const fileHash = "imageHash3";

        // Processing
        const webp = await convertImage(png, fileHash);
        expect(webp.subarray(0, 4).toString()).toEqual("RIFF");

        // Cache
        expect(await convertImage(png, fileHash)).toEqual(webp);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/${fileHash}.webp`, "test");
        expect(await convertImage(png, fileHash)).toEqual(Buffer.from("test"));
    });
});