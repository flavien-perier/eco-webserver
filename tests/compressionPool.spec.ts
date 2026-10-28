const { gunzipSync, brotliDecompressSync } = require("zlib");
const proxyquire = require("proxyquire").noPreserveCache();

const { CompressionPool, compressData } = require("../src/compressionPool.ts");

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

    it("Compresses data with only the requested algorithm", async () => {
        const pool = new CompressionPool(1);
        const input = "single encoding payload";

        const gzipData = await pool.compress(input, "gzip");
        const brotliData = await pool.compress(input, "br");

        expect(Buffer.isBuffer(gzipData)).toBeTrue();
        expect(Buffer.isBuffer(brotliData)).toBeTrue();
        expect(gunzipSync(gzipData).toString()).toEqual(input);
        expect(brotliDecompressSync(brotliData).toString()).toEqual(input);
    });

    it("Rejects new tasks when the compression queue is full", async () => {
        const { CompressionPool: BoundedCompressionPool } = proxyquire("../src/compressionPool.ts", {
            "./configuration.ts": { default: { compressionMaxQueue: 1 } }
        });
        const pool = new BoundedCompressionPool(1);
        const firstTask = pool.compress("first payload");
        const queuedTask = pool.compress("queued payload");

        let rejection;
        try {
            await pool.compress("overflow payload");
        } catch(err) {
            rejection = err;
        }

        expect(rejection).toEqual(jasmine.any(Error));
        expect(rejection.statusCode).toEqual(503);
        await Promise.all([firstTask, queuedTask]);
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