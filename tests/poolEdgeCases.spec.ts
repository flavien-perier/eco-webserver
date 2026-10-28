const { EventEmitter } = require("events");
const { gzipSync, brotliCompressSync, gunzipSync, brotliDecompressSync } = require("zlib");
const proxyquire = require("proxyquire").noPreserveCache();

const { CompressionPool } = require("../src/compressionPool.ts");
const TaskLimiter = require("../src/taskLimiter.ts");

function loadCpuPool(Worker: any, configuration: Record<string, any>) {
    return proxyquire("../src/cpuPool.ts", {
        "worker_threads": { Worker },
        "./configuration.ts": { default: configuration, "@global": true },
    }).runCpuTask;
}

describe("compressionPool edge cases", () => {
    it("round-trips empty, Unicode and large inputs", async () => {
        const pool = new CompressionPool(2);
        const inputs = [
            "",
            "Compression accentuée : café, crème, 😀 et 東京",
            "large-payload-😀-".repeat(20000),
        ];

        const results = await Promise.all(inputs.map(input => pool.compress(input)));
        results.forEach((result, index) => {
            expect(gunzipSync(result.gzipData).toString("utf8")).toBe(inputs[index]);
            expect(brotliDecompressSync(result.brotliData).toString("utf8")).toBe(inputs[index]);
        });
        expect(pool.queue.length).toBe(0);
    });

    it("rejects a failed task and replaces its worker", async () => {
        const instances: any[] = [];
        class FakeWorker extends EventEmitter {
            constructor() {
                super();
                instances.push(this);
            }

            postMessage({ data }) {
                queueMicrotask(() => {
                    if (data === "crash") {
                        this.emit("error", new Error("expected worker failure"));
                        return;
                    }
                    this.emit("message", {
                        gzipData: gzipSync(data),
                        brotliData: brotliCompressSync(data),
                    });
                });
            }
        }
        const { CompressionPool: StubbedCompressionPool } = proxyquire("../src/compressionPool.ts", {
            "worker_threads": { Worker: FakeWorker },
            "./configuration.ts": { default: { compressionMaxQueue: 4 } },
        });
        const pool = new StubbedCompressionPool(1);

        const error = await pool.compress("crash", "gzip").then(() => null, err => err);
        expect(error.message).toBe("expected worker failure");
        expect(instances.length).toBe(2);
        expect(pool.workers.length).toBe(1);
        expect(pool.workers[0]).not.toBe(instances[0]);

        const output = await pool.compress("recovered", "gzip");
        expect(gunzipSync(output).toString()).toBe("recovered");
    });
});

describe("cpuPool edge cases", () => {
    it("keeps empty input local and sends Unicode and large inputs to workers", async () => {
        const runCpuTask = proxyquire("../src/cpuPool.ts", {
            "./configuration.ts": {
                default: { cpuWorkerThreshold: 8, cpuPoolSize: 1, cpuMaxQueue: 2 },
                "@global": true,
            },
        }).runCpuTask;
        const noLocalFallback = () => {
            throw new Error("The local fallback must not run");
        };
        const unicodeDocument = JSON.stringify({ text: "😀 café 東京" }, null, 2);
        const largeDocument = JSON.stringify({
            values: Array.from({ length: 1000 }, (unused, index) => ({ index, text: "payload" })),
        }, null, 2);

        expect(await runCpuTask("json", "", () => "empty-local")).toBe("empty-local");
        expect(await runCpuTask("json", unicodeDocument, noLocalFallback)).toBe(JSON.stringify({ text: "😀 café 東京" }));
        const largeResult = await runCpuTask("json", largeDocument, noLocalFallback);
        expect(JSON.parse(largeResult).values.length).toBe(1000);
        expect(JSON.parse(largeResult).values[999]).toEqual({ index: 999, text: "payload" });
    });

    it("rejects a worker failure and lazily creates a replacement", async () => {
        const instances: any[] = [];
        class FakeWorker extends EventEmitter {
            terminated: boolean = false;

            constructor() {
                super();
                instances.push(this);
            }

            ref() {}
            unref() {}

            postMessage({ id, input }) {
                queueMicrotask(() => {
                    if (input === "crash") this.emit("error", new Error("CPU worker failed"));
                    else this.emit("message", { id, result: "recovered" });
                });
            }

            terminate() {
                this.terminated = true;
                return Promise.resolve();
            }
        }
        const runCpuTask = loadCpuPool(FakeWorker, {
            cpuWorkerThreshold: 0,
            cpuPoolSize: 1,
            cpuMaxQueue: 0,
        });
        const localTask = () => {
            throw new Error("The local fallback must not run");
        };

        const error = await runCpuTask("json", "crash", localTask).then(() => null, err => err);
        expect(error.message).toBe("CPU worker failed");
        expect(instances[0].terminated).toBeTrue();
        expect(await runCpuTask("json", "next", localTask)).toBe("recovered");
        expect(instances.length).toBe(2);
    });

    it("drains queued work after a worker reports a processing error", async () => {
        const instances: any[] = [];
        class FakeWorker extends EventEmitter {
            constructor() {
                super();
                instances.push(this);
            }

            ref() {}
            unref() {}

            postMessage({ id, input }) {
                queueMicrotask(() => {
                    if (input === "invalid") {
                        this.emit("message", {
                            id,
                            error: { name: "SyntaxError", message: "Invalid JSON" },
                        });
                    } else {
                        this.emit("message", { id, result: "queued-result" });
                    }
                });
            }

            terminate() {
                return Promise.resolve();
            }
        }
        const runCpuTask = loadCpuPool(FakeWorker, {
            cpuWorkerThreshold: 0,
            cpuPoolSize: 1,
            cpuMaxQueue: 1,
        });
        const localTask = () => {
            throw new Error("The local fallback must not run");
        };

        const first = runCpuTask("json", "invalid", localTask);
        const queued = runCpuTask("json", "valid", localTask);
        const error = await first.then(() => null, err => err);

        expect(error.name).toBe("SyntaxError");
        expect(error.message).toBe("Invalid JSON");
        expect(await queued).toBe("queued-result");
        expect(instances.length).toBe(1);
    });
});

describe("TaskLimiter edge cases", () => {
    it("drains queued tasks after a rejection and releases every slot", async () => {
        const limiter = new TaskLimiter(1, 1);
        let rejectFirst;
        const first = limiter.run(() => new Promise((resolveTask, rejectTask) => {
            rejectFirst = rejectTask;
        }));
        const queued = limiter.run(async () => "queued-result");
        const overflow = limiter.run(async () => "overflow");

        await expectAsync(overflow).toBeRejectedWithError("Processing queue is full");
        rejectFirst(new Error("expected task rejection"));
        await expectAsync(first).toBeRejectedWithError("expected task rejection");
        expect(await queued).toBe("queued-result");
        await new Promise(resolveImmediate => setImmediate(resolveImmediate));
        expect(limiter.active).toBe(0);
        expect(limiter.queue.length).toBe(0);
        expect(await limiter.run(async () => "reused")).toBe("reused");
    });
});
