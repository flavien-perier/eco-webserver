const { gunzipSync, brotliDecompressSync } = require("zlib");

const { CompressionPool, compressData } = require("../src/compressionPool.cts");

describe("compressionPool", () => {
    it("Compresses data with gzip and brotli in a worker", async () => {
        const pool = new CompressionPool(2);
        const input = "test data to compress, test data to compress, test data to compress";

        const { gzipData, brotliData } = await pool.compress(input);

        expect(gzipData.length).toBeGreaterThan(0);
        expect(brotliData.length).toBeGreaterThan(0);
        expect(gunzipSync(gzipData).toString()).toEqual(input);
        expect(brotliDecompressSync(brotliData).toString()).toEqual(input);
    });

    it("Runs concurrent compressions on multiple workers", async () => {
        const pool = new CompressionPool(2);

        const results = await Promise.all([
            pool.compress("first payload"),
            pool.compress("second payload"),
            pool.compress("third payload")
        ]);

        expect(gunzipSync(results[0].gzipData).toString()).toEqual("first payload");
        expect(gunzipSync(results[1].gzipData).toString()).toEqual("second payload");
        expect(gunzipSync(results[2].gzipData).toString()).toEqual("third payload");
        expect(pool.queue.length).toEqual(0);
        expect(pool.workers.length).toEqual(2);
    });

    it("Reuses an idle worker instead of creating a new one", async () => {
        const pool = new CompressionPool(2);

        await pool.compress("first task");

        const workersCount = pool.workers.length;

        await pool.compress("second task");

        expect(pool.workers.length).toEqual(workersCount);
    });

    it("compressData gives the same result as the worker", () => {
        const input = "synchronous comparison payload";

        const { gzipData, brotliData } = compressData(input);

        expect(gunzipSync(gzipData).toString()).toEqual(input);
        expect(brotliDecompressSync(brotliData).toString()).toEqual(input);
    });
});