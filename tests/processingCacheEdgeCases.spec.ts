const fs = require("fs");
const { randomUUID } = require("crypto");
const { dirname, join } = require("path");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_ROOT = join("/tmp/opencode", `processing-cache-edge-${process.pid}-${randomUUID()}`);

describe("processingCache edge cases", () => {
    let testDirectory;
    let cacheDir;
    let testIndex = 0;
    let instances;

    const loadCache = (overrides = {}, fsStub = null) => {
        const stubs = {
            "./configuration.ts": {
                default: {
                    cacheDir,
                    diskCacheMaxSize: 512 * 1024 * 1024,
                    diskCacheCleanupInterval: 60 * 60 * 1000,
                    diskWriteConcurrency: 2,
                    diskWriteMaxQueue: 100,
                    ...overrides,
                },
                "@global": true,
            }
        };
        if (fsStub) stubs["fs/promises"] = fsStub;
        const instance = proxyquire("../src/processingCache.ts", stubs);
        instances.push(instance);
        return instance;
    };

    beforeEach(() => {
        testDirectory = join(TEST_ROOT, `case-${++testIndex}`);
        cacheDir = join(testDirectory, "nested", "cache");
        instances = [];
        fs.mkdirSync(testDirectory, { recursive: true });
    });

    afterEach(async () => {
        for (const instance of instances) await instance.flushProcessingCache();
        fs.rmSync(testDirectory, { recursive: true, force: true });
    });

    afterAll(() => {
        fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    });

    it("handles an absent cache directory and creates nested directories on write", async () => {
        const cache = loadCache();

        expect(await cache.readProcessingCache("missing", "js")).toBeNull();
        await cache.writeProcessingCache("created", "created", "js");
        await cache.flushProcessingCache();

        expect(fs.statSync(cacheDir).isDirectory()).toBeTrue();
        expect((await cache.readProcessingCache("created", "js")).toString()).toEqual("created");
    });

    it("propagates read errors other than a missing artefact", async () => {
        const cache = loadCache({}, {
            ...fs.promises,
            readFile: async () => {
                const error = new Error("read denied");
                error.code = "EACCES";
                throw error;
            }
        });

        await expectAsync(cache.readProcessingCache("denied", "js")).toBeRejectedWithError("read denied");
    });

    it("returns arbitrary or corrupted artefact bytes without altering them", async () => {
        const cache = loadCache();
        const corrupted = Buffer.from([0, 255, 1, 2, 0, 128]);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(join(cacheDir, "corrupt-v2.js"), corrupted);

        const result = await cache.readProcessingCache("corrupt", "js");

        expect(Buffer.compare(result, corrupted)).toEqual(0);
    });

    it("deduplicates active writes by hash and format", async () => {
        const realWriteFile = fs.promises.writeFile;
        let releaseWrite;
        let announceWrite;
        let writeCount = 0;
        const writeGate = new Promise(resolve => {
            releaseWrite = resolve;
        });
        const writeStarted = new Promise(resolve => {
            announceWrite = resolve;
        });
        const cache = loadCache({}, {
            ...fs.promises,
            writeFile: async (...args) => {
                writeCount++;
                if (args[1].toString() === "first") {
                    announceWrite();
                    await writeGate;
                }
                return realWriteFile(...args);
            }
        });

        const first = cache.writeProcessingCache("first", "shared", "js");
        await writeStarted;
        await cache.writeProcessingCache("duplicate", "shared", "js");
        await cache.writeProcessingCache("other-format", "shared", "css");
        releaseWrite();
        await first;
        await cache.flushProcessingCache();

        expect(writeCount).toEqual(2);
        expect((await cache.readProcessingCache("shared", "js")).toString()).toEqual("first");
        expect((await cache.readProcessingCache("shared", "css")).toString()).toEqual("other-format");
    });

    it("drops writes above the waiting queue limit on a best-effort basis", async () => {
        const realWriteFile = fs.promises.writeFile;
        let releaseWrite;
        let announceWrite;
        const writeGate = new Promise(resolve => {
            releaseWrite = resolve;
        });
        const writeStarted = new Promise(resolve => {
            announceWrite = resolve;
        });
        const cache = loadCache({ diskWriteConcurrency: 1, diskWriteMaxQueue: 1 }, {
            ...fs.promises,
            writeFile: async (...args) => {
                if (args[1].toString() === "active") {
                    announceWrite();
                    await writeGate;
                }
                return realWriteFile(...args);
            }
        });

        await cache.writeProcessingCache("active", "active", "js");
        await writeStarted;
        await cache.writeProcessingCache("queued", "queued", "js");
        await cache.writeProcessingCache("dropped", "dropped", "js");
        releaseWrite();
        await cache.flushProcessingCache();

        expect((await cache.readProcessingCache("active", "js")).toString()).toEqual("active");
        expect((await cache.readProcessingCache("queued", "js")).toString()).toEqual("queued");
        expect(await cache.readProcessingCache("dropped", "js")).toBeNull();
    });

    it("flush waits for all concurrent queued writes and leaves no temporary files", async () => {
        const realWriteFile = fs.promises.writeFile;
        const cache = loadCache({ diskWriteConcurrency: 3 }, {
            ...fs.promises,
            writeFile: async (...args) => {
                await new Promise(resolve => setImmediate(resolve));
                return realWriteFile(...args);
            }
        });

        await Promise.all(Array.from({ length: 12 }, (_, index) =>
            cache.writeProcessingCache(`value-${index}`, `hash-${index}`, "js")
        ));
        await cache.flushProcessingCache();

        for (let index = 0; index < 12; index++) {
            expect((await cache.readProcessingCache(`hash-${index}`, "js")).toString()).toEqual(`value-${index}`);
        }
        expect(fs.readdirSync(cacheDir).some(file => file.endsWith(".tmp"))).toBeFalse();
    });

    it("contains directory creation failures without rejecting writes or flush", async () => {
        fs.mkdirSync(dirname(cacheDir), { recursive: true });
        fs.writeFileSync(cacheDir, "not a directory");
        const cache = loadCache();

        await cache.writeProcessingCache("discarded", "discarded", "js");
        await cache.flushProcessingCache();

        expect(fs.readFileSync(cacheDir, "utf8")).toEqual("not a directory");
    });

    it("keeps an exactly full cache and evicts oldest artefacts only above the limit", async () => {
        const cache = loadCache();
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(join(cacheDir, "old-v2.js"), "1234");
        fs.writeFileSync(join(cacheDir, "new-v2.js"), "5678");
        const oldDate = new Date(Date.now() - 60000);
        fs.utimesSync(join(cacheDir, "old-v2.js"), oldDate, oldDate);

        await cache.cleanProcessingCache(8);
        expect(fs.existsSync(join(cacheDir, "old-v2.js"))).toBeTrue();

        await cache.cleanProcessingCache(7);
        expect(fs.existsSync(join(cacheDir, "old-v2.js"))).toBeFalse();
        expect(fs.existsSync(join(cacheDir, "new-v2.js"))).toBeTrue();
    });

    it("cleanup ignores temporary files and artefacts with other prefixes", async () => {
        const cache = loadCache();
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(join(cacheDir, "current-v2.js"), "1234");
        fs.writeFileSync(join(cacheDir, "current-v2.js.pid.tmp"), "temporary");
        fs.writeFileSync(join(cacheDir, "v1-old.js"), "old prefix");
        fs.writeFileSync(join(cacheDir, "unrelated.txt"), "unrelated");

        await cache.cleanProcessingCache(4);

        expect(fs.readdirSync(cacheDir).sort()).toEqual([
            "current-v2.js",
            "current-v2.js.pid.tmp",
            "unrelated.txt",
            "v1-old.js",
        ]);
    });

    it("cleanup accounts for artefacts disappearing between stat and unlink", async () => {
        const unlinked = [];
        const cache = loadCache({}, {
            ...fs.promises,
            readdir: async () => ["keep-v2.js", "old-v2.js", "vanished-v2.js", "gone-v2.js"],
            stat: async filePath => {
                if (filePath.endsWith("gone-v2.js")) {
                    const error = new Error("gone");
                    error.code = "ENOENT";
                    throw error;
                }
                const mtimes = { "keep-v2.js": 3000, "old-v2.js": 2000, "vanished-v2.js": 1000 };
                return { size: 10, mtimeMs: mtimes[filePath.split("/").pop()] };
            },
            unlink: async filePath => {
                const name = filePath.split("/").pop();
                unlinked.push(name);
                if (name === "vanished-v2.js") {
                    const error = new Error("vanished");
                    error.code = "ENOENT";
                    throw error;
                }
            }
        });

        await cache.cleanProcessingCache(15);

        expect(unlinked).toEqual(["vanished-v2.js", "old-v2.js"]);
    });

    it("runs best-effort cleanup after every write when the interval is zero", async () => {
        const cache = loadCache({ diskCacheMaxSize: 5, diskCacheCleanupInterval: 0 });

        await cache.writeProcessingCache("old", "old", "js");
        await cache.flushProcessingCache();
        const oldDate = new Date(Date.now() - 60000);
        fs.utimesSync(join(cacheDir, "old-v2.js"), oldDate, oldDate);
        await cache.writeProcessingCache("new", "new", "js");
        await cache.flushProcessingCache();

        expect(fs.existsSync(join(cacheDir, "old-v2.js"))).toBeFalse();
        expect((await cache.readProcessingCache("new", "js")).toString()).toEqual("new");
    });

    it("keeps the previous complete artefact visible until an atomic replacement finishes", async () => {
        const realWriteFile = fs.promises.writeFile;
        let releaseWrite;
        let announceWrite;
        const writeGate = new Promise(resolve => {
            releaseWrite = resolve;
        });
        const writeStarted = new Promise(resolve => {
            announceWrite = resolve;
        });
        const cache = loadCache({}, {
            ...fs.promises,
            writeFile: async (...args) => {
                if (args[1].toString() === "replacement") {
                    announceWrite();
                    await writeGate;
                }
                return realWriteFile(...args);
            }
        });

        await cache.writeProcessingCache("original", "atomic", "js");
        await cache.flushProcessingCache();
        const replacement = cache.writeProcessingCache("replacement", "atomic", "js");
        await writeStarted;
        const duringWrite = await cache.readProcessingCache("atomic", "js");
        releaseWrite();
        await replacement;
        await cache.flushProcessingCache();

        expect(duringWrite.toString()).toEqual("original");
        expect((await cache.readProcessingCache("atomic", "js")).toString()).toEqual("replacement");
        expect(fs.readdirSync(cacheDir)).toEqual(["atomic-v2.js"]);
    });
});
