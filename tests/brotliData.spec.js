const { brotliDecompressSync } = require("zlib");

const brotliData = require("../src/brotliData");

describe("brotliData", () => {
    it("Element is lower after brotli and decompressable", () => {
        const input = Buffer.from("test data to compress with brotli algorithm, test data to compress with brotli algorithm");

        const brotliBuffer = brotliData(input);

        expect(brotliBuffer.length < input.length).toBeTrue();

        const decompressedBuffer = brotliDecompressSync(brotliBuffer);

        expect(input).toEqual(decompressedBuffer);
    });
});