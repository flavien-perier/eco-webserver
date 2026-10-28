const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const SANDBOX_DIR = "./tests/testDist/raw-resource-cache";
const OUTSIDE_FILE = "./tests/testDist/raw-resource-cache-outside.txt";

describe("rawResourceCache", () => {
    const loadCache = (overrides = {}, fsStub = null) => {
        const stubs = {
            "./configuration.cts": {
                default: {
                    distDir: SANDBOX_DIR,
                    rawCacheMaxEntries: 500,
                    rawCacheMaxSize: 50 * 1024 * 1024,
                    cacheValidationInterval: 60 * 1000,
                    ...overrides,
                },
                "@global": true,
            }
        };
        if (fsStub) stubs["fs/promises"] = fsStub;
        return proxyquire("../src/rawResourceCache.cts", stubs).readLocalResource;
    };

    beforeEach(() => {
        fs.mkdirSync(SANDBOX_DIR);
    });

    afterEach(() => {
        fs.rmSync(SANDBOX_DIR, { recursive: true });
        fs.rmSync(OUTSIDE_FILE, { force: true });
    });

    it("Should deduplicate concurrent reads and reuse the raw buffer", async () => {
        fs.writeFileSync(SANDBOX_DIR + "/asset.txt", "raw content");
        let readCount = 0;
        const readLocalResource = loadCache({}, {
            readFile: async filePath => {
                readCount++;
                await new Promise(resolve => setTimeout(resolve, 10));
                return fs.promises.readFile(filePath);
            }
        });

        const [first, second] = await Promise.all([
            readLocalResource("/asset.txt"),
            readLocalResource("/asset.txt")
        ]);
        const third = await readLocalResource("/asset.txt");

        expect(first.toString()).toEqual("raw content");
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(readCount).toEqual(1);
    });

    it("Should evict the least recently used entry above the entry limit", async () => {
        for (const name of ["a", "b", "c"]) fs.writeFileSync(`${SANDBOX_DIR}/${name}.txt`, name);
        let readCount = 0;
        const readLocalResource = loadCache({ rawCacheMaxEntries: 2 }, {
            readFile: async filePath => {
                readCount++;
                return fs.promises.readFile(filePath);
            }
        });

        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");
        await readLocalResource("/a.txt");
        await readLocalResource("/c.txt");
        await readLocalResource("/b.txt");

        expect(readCount).toEqual(4);
    });

    it("Should evict entries above the total buffer size limit", async () => {
        fs.writeFileSync(SANDBOX_DIR + "/a.txt", "aaaa");
        fs.writeFileSync(SANDBOX_DIR + "/b.txt", "bbbb");
        let readCount = 0;
        const readLocalResource = loadCache({ rawCacheMaxSize: 5 }, {
            readFile: async filePath => {
                readCount++;
                return fs.promises.readFile(filePath);
            }
        });

        await readLocalResource("/a.txt");
        await readLocalResource("/b.txt");
        await readLocalResource("/a.txt");

        expect(readCount).toEqual(3);
    });

    it("Should revalidate a cached resource using its modification time", async () => {
        const filePath = SANDBOX_DIR + "/asset.txt";
        fs.writeFileSync(filePath, "before");
        const readLocalResource = loadCache({ cacheValidationInterval: 1 });

        expect((await readLocalResource("/asset.txt")).toString()).toEqual("before");
        fs.writeFileSync(filePath, "after!");
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(filePath, future, future);
        await new Promise(resolve => setTimeout(resolve, 5));

        expect((await readLocalResource("/asset.txt")).toString()).toEqual("after!");
    });

    it("Should reject paths outside distDir, symlinks and missing files", async () => {
        fs.writeFileSync(OUTSIDE_FILE, "outside");
        fs.writeFileSync(SANDBOX_DIR + "/target.txt", "target");
        fs.symlinkSync(SANDBOX_DIR + "/target.txt", SANDBOX_DIR + "/link.txt");
        const readLocalResource = loadCache();

        expect(await readLocalResource("/%2e%2e/raw-resource-cache-outside.txt")).toBeNull();
        expect(await readLocalResource("/link.txt")).toBeNull();
        expect(await readLocalResource("/missing.txt")).toBeNull();
    });
});
