const fs = require("fs");
const { randomUUID } = require("crypto");
const { join } = require("path");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_ROOT = join("/tmp/opencode", `raw-resource-cache-edge-${process.pid}-${randomUUID()}`);

describe("rawResourceCache edge cases", () => {
    let testDirectory;
    let distDir;
    let testIndex = 0;

    const loadCache = (overrides = {}, fsStub = null) => {
        const stubs = {
            "./configuration.ts": {
                default: {
                    distDir,
                    rawCacheMaxEntries: 500,
                    rawCacheMaxSize: 50 * 1024 * 1024,
                    cacheValidationInterval: 60 * 1000,
                    ...overrides,
                },
                "@global": true,
            }
        };
        if (fsStub) stubs["fs/promises"] = fsStub;
        return proxyquire("../src/rawResourceCache.ts", stubs).readLocalResource;
    };

    beforeEach(() => {
        testDirectory = join(TEST_ROOT, `case-${++testIndex}`);
        distDir = join(testDirectory, "dist");
        fs.mkdirSync(distDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(testDirectory, { recursive: true, force: true });
    });

    afterAll(() => {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    });

    it("deduplicates concurrent misses without negatively caching a later restoration", async () => {
        const realLstat = fs.promises.lstat;
        let statCount = 0;
        const readLocalResource = loadCache({}, {
            ...fs.promises,
            lstat: async filePath => {
                statCount++;
                await new Promise(resolve => setImmediate(resolve));
                return realLstat(filePath);
            }
        });

        const [first, second] = await Promise.all([
            readLocalResource("/asset.txt"),
            readLocalResource("/asset.txt"),
        ]);
        fs.writeFileSync(join(distDir, "asset.txt"), "restored");
        const restored = await readLocalResource("/asset.txt");

        expect(first).toBeNull();
        expect(second).toBeNull();
        expect(restored.toString()).toEqual("restored");
        expect(statCount).toEqual(2);
    });

    it("serves files above the size limit without caching them", async () => {
        fs.writeFileSync(join(distDir, "large.txt"), "12345");
        const realReadFile = fs.promises.readFile;
        let readCount = 0;
        const readLocalResource = loadCache({ rawCacheMaxSize: 4 }, {
            ...fs.promises,
            readFile: async (...args) => {
                readCount++;
                return realReadFile(...args);
            }
        });

        const first = await readLocalResource("/large.txt");
        const second = await readLocalResource("/large.txt");

        expect(first.toString()).toEqual("12345");
        expect(second.toString()).toEqual("12345");
        expect(readCount).toEqual(2);
    });

    it("retains recently used entries when enforcing the entry limit", async () => {
        for (const name of ["a", "b", "c"]) fs.writeFileSync(join(distDir, `${name}.txt`), name);
        const realReadFile = fs.promises.readFile;
        let readCount = 0;
        const readLocalResource = loadCache({ rawCacheMaxEntries: 2 }, {
            ...fs.promises,
            readFile: async (...args) => {
                readCount++;
                return realReadFile(...args);
            }
        });

        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");
        await readLocalResource("/a.txt");
        await readLocalResource("/c.txt");
        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");

        expect(readCount).toEqual(4);
    });

    it("keeps entries at the exact size limit and evicts least recent entries above it", async () => {
        fs.writeFileSync(join(distDir, "a.txt"), "aaaa");
        fs.writeFileSync(join(distDir, "b.txt"), "bbbb");
        fs.writeFileSync(join(distDir, "c.txt"), "c");
        const realReadFile = fs.promises.readFile;
        let readCount = 0;
        const readLocalResource = loadCache({ rawCacheMaxSize: 8 }, {
            ...fs.promises,
            readFile: async (...args) => {
                readCount++;
                return realReadFile(...args);
            }
        });

        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");
        await readLocalResource("/a.txt");
        expect(readCount).toEqual(2);

        await readLocalResource("/c.txt");
        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");

        expect(readCount).toEqual(4);
    });

    it("revalidates modified content after the validation interval", async () => {
        const filePath = join(distDir, "asset.txt");
        fs.writeFileSync(filePath, "before");
        const readLocalResource = loadCache({ cacheValidationInterval: 1 });

        expect((await readLocalResource("/asset.txt")).toString()).toEqual("before");
        fs.writeFileSync(filePath, "after!");
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(filePath, future, future);
        await new Promise(resolve => setTimeout(resolve, 5));

        expect((await readLocalResource("/asset.txt")).toString()).toEqual("after!");
    });

    it("evicts deleted content and reads a restored file without a negative cache", async () => {
        const filePath = join(distDir, "asset.txt");
        fs.writeFileSync(filePath, "before");
        const readLocalResource = loadCache({ cacheValidationInterval: 1 });
        expect((await readLocalResource("/asset.txt")).toString()).toEqual("before");

        await new Promise(resolve => setTimeout(resolve, 5));
        fs.unlinkSync(filePath);
        expect(await readLocalResource("/asset.txt")).toBeNull();

        fs.writeFileSync(filePath, "restored");
        expect((await readLocalResource("/asset.txt")).toString()).toEqual("restored");
    });

    it("deduplicates concurrent read errors and permits an immediate retry", async () => {
        fs.writeFileSync(join(distDir, "asset.txt"), "available");
        const realReadFile = fs.promises.readFile;
        let releaseRead;
        let announceRead;
        let readCount = 0;
        let failRead = true;
        const readGate = new Promise(resolve => {
            releaseRead = resolve;
        });
        const readStarted = new Promise(resolve => {
            announceRead = resolve;
        });
        const readLocalResource = loadCache({}, {
            ...fs.promises,
            readFile: async (...args) => {
                readCount++;
                if (failRead) {
                    announceRead();
                    await readGate;
                    const error = new Error("read failed");
                    error.code = "EACCES";
                    throw error;
                }
                return realReadFile(...args);
            }
        });

        const first = readLocalResource("/asset.txt");
        const second = readLocalResource("/asset.txt");
        await readStarted;
        releaseRead();
        const results = await Promise.allSettled([first, second]);
        failRead = false;
        const retry = await readLocalResource("/asset.txt");

        expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
        expect(results[0].reason.message).toEqual("read failed");
        expect(results[1].reason.message).toEqual("read failed");
        expect(retry.toString()).toEqual("available");
        expect(readCount).toEqual(2);
    });

    it("returns null for directories and file or directory symlinks", async () => {
        fs.mkdirSync(join(distDir, "directory"));
        fs.writeFileSync(join(distDir, "target.txt"), "target");
        fs.symlinkSync(join(distDir, "target.txt"), join(distDir, "file-link.txt"));
        fs.symlinkSync(join(distDir, "directory"), join(distDir, "directory-link"));
        const readLocalResource = loadCache();

        expect(await readLocalResource("/directory")).toBeNull();
        expect(await readLocalResource("/file-link.txt")).toBeNull();
        expect(await readLocalResource("/directory-link")).toBeNull();
    });

    it("rejects plain and encoded traversal outside distDir", async () => {
        fs.writeFileSync(join(testDirectory, "outside.txt"), "outside");
        const readLocalResource = loadCache();

        expect(await readLocalResource("/../outside.txt")).toBeNull();
        expect(await readLocalResource("/%2e%2e/outside.txt")).toBeNull();
        expect(await readLocalResource("/%2E%2E%2Foutside.txt")).toBeNull();
        expect(await readLocalResource("/safe/../../outside.txt")).toBeNull();
    });

    it("returns null instead of rejecting malformed percent-encoded URIs", async () => {
        const readLocalResource = loadCache();

        expect(await readLocalResource("/%")).toBeNull();
        expect(await readLocalResource("/%2")).toBeNull();
        expect(await readLocalResource("/%E0%A4%A")).toBeNull();
    });

    it("resolves raw and encoded unicode paths to the same cached resource", async () => {
        const name = "café-🚀.txt";
        fs.writeFileSync(join(distDir, name), "unicode");
        const readLocalResource = loadCache();

        const raw = await readLocalResource(`/${name}`);
        const encoded = await readLocalResource(`/${encodeURIComponent(name)}`);

        expect(raw.toString()).toEqual("unicode");
        expect(encoded).toBe(raw);
    });

    it("does not follow a symlink substituted between validation and reading", async () => {
        const assetPath = join(distDir, "asset.txt");
        const outsidePath = join(testDirectory, "outside.txt");
        fs.writeFileSync(assetPath, "inside");
        fs.writeFileSync(outsidePath, "outside");
        const realLstat = fs.promises.lstat;
        let substituteLink = true;
        const readLocalResource = loadCache({}, {
            ...fs.promises,
            lstat: async filePath => {
                const details = await realLstat(filePath);
                if (filePath === assetPath && substituteLink) {
                    substituteLink = false;
                    fs.unlinkSync(assetPath);
                    fs.symlinkSync(outsidePath, assetPath);
                }
                return details;
            }
        });

        expect(await readLocalResource("/asset.txt")).toBeNull();
    });
});
