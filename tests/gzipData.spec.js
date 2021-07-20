const { createHash } = require("crypto");
const { unzipSync } = require("zlib");

const gzipData = require("../src/gzipData");

describe("gzipData", () => {
    it("Element is lower after gzip and unzippable", () => {
        const bigBuffer = Buffer.from(createHash("sha512").update("myKey").digest("hex"));

        const gzipBuffer = gzipData(bigBuffer);

        expect(gzipBuffer.length < bigBuffer.length).toBeTrue();

        const unzippedBuffer = unzipSync(gzipBuffer);

        expect(bigBuffer).toEqual(unzippedBuffer);
    });
});
