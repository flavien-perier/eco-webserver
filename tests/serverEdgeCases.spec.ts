const fs = require("fs");
const http = require("http");
const path = require("path");
const { gunzipSync } = require("zlib");
const proxyquire = require("proxyquire").noPreserveCache();

const TEMP_ROOT = "/tmp/opencode";

type RawResponse = {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
};

describe("server HTTP edge cases", () => {
    let rootDir: string;
    let distDir: string;
    let servers: Array<import("http").Server>;

    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(TEMP_ROOT, "eco-server-edge-"));
        distDir = path.join(rootDir, "dist");
        fs.mkdirSync(distDir);
        fs.mkdirSync(path.join(rootDir, "cache"));
        fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><body><p>edge case</p></body></html>");
        servers = [];
    });

    afterEach(async () => {
        try {
            for (const server of servers.reverse()) {
                if (!server.listening) continue;
                await new Promise<void>(resolve => {
                    server.close(() => resolve());
                    server.closeAllConnections();
                });
            }
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    function configuration(overrides: Record<string, any> = {}): Record<string, any> {
        return {
            port: 0,
            cacheCycle: 1800,
            distDir,
            cacheDir: path.join(rootDir, "cache"),
            logDir: path.join(rootDir, "server.log"),
            accessLog: false,
            enableIsomorphic: false,
            chromiumPath: null,
            header: {},
            contentType: {
                html: "text/html",
                css: "text/css",
                js: "application/javascript",
                json: "application/json",
                svg: "image/svg+xml",
                xml: "application/xml",
                txt: "text/plain",
                png: "image/png",
                webp: "image/webp",
            },
            proxy: {},
            use404File: false,
            ...overrides,
        };
    }

    async function startServer(overrides: Record<string, any> = {}, stubs: Record<string, any> = {}): Promise<import("http").Server> {
        const server = proxyquire("../src/server.ts", {
            "./configuration.ts": {
                default: configuration(overrides),
                "@global": true,
            },
            ...stubs,
        })();
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        return server;
    }

    function requestRaw(server: import("http").Server, requestPath: string, options: {
        method?: string;
        headers?: Record<string, string>;
    } = {}): Promise<RawResponse> {
        return new Promise((resolve, reject) => {
            const address = server.address();
            const req = http.request({
                host: "127.0.0.1",
                port: address.port,
                path: requestPath,
                method: options.method || "GET",
                headers: options.headers || {},
            }, res => {
                const chunks: Buffer[] = [];
                res.on("data", chunk => chunks.push(chunk));
                res.on("end", () => resolve({
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }));
            });
            req.setTimeout(2000, () => req.destroy(new Error("Test request timed out")));
            req.on("error", reject);
            req.end();
        });
    }

    it("returns HEAD headers without a response body", async () => {
        const server = await startServer();

        const head = await requestRaw(server, "/", { method: "HEAD" });
        const get = await requestRaw(server, "/");

        expect(head.statusCode).toEqual(200);
        expect(head.body.length).toEqual(0);
        expect(head.headers["content-type"]).toEqual("text/html");
        expect(head.headers.etag).toEqual(get.headers.etag);
        expect(head.headers["content-length"]).toEqual(get.headers["content-length"]);
        expect(Number(head.headers["content-length"])).toEqual(get.body.length);
    });

    it("returns an empty 304 for the same validator across encoding variants", async () => {
        const server = await startServer();
        const initial = await requestRaw(server, "/");
        const etag = initial.headers.etag as string;

        for (const encoding of ["identity", "gzip", "br"]) {
            const response = await requestRaw(server, "/", {
                headers: {
                    "Accept-Encoding": encoding,
                    "If-None-Match": etag,
                },
            });

            expect(response.statusCode).toEqual(304);
            expect(response.body.length).toEqual(0);
            expect(response.headers.etag).toEqual(etag);
            expect(response.headers["content-encoding"]).toBeUndefined();
        }
    });

    it("serves a percent-encoded filename without decoding the query into the path", async () => {
        fs.writeFileSync(path.join(distDir, "hello world.html"), "<!doctype html><html><body>encoded</body></html>");
        const server = await startServer();

        const response = await requestRaw(server, "/hello%20world.html?next=%2Fsecret");

        expect(response.statusCode).toEqual(200);
        expect(response.body.toString()).toContain("encoded");
    });

    it("rejects malformed percent encoding with a client error", async () => {
        const server = await startServer();

        const response = await requestRaw(server, "/bad%ZZpath");

        expect(response.statusCode).toEqual(400);
        expect(response.body.length).toEqual(0);
    });

    it("rejects encoded traversal outside distDir without exposing the target", async () => {
        fs.writeFileSync(path.join(rootDir, "secret.html"), "outside secret");
        const server = await startServer();

        const response = await requestRaw(server, "/..%2fsecret.html");

        expect([400, 403]).toContain(response.statusCode);
        expect(response.body.toString()).not.toContain("outside secret");
    });

    it("rejects an encoded NUL byte with a client error", async () => {
        const server = await startServer();

        const response = await requestRaw(server, "/index%00.html");

        expect(response.statusCode).toEqual(400);
        expect(response.body.length).toEqual(0);
    });

    it("compresses the configured 404 fallback while preserving its status", async () => {
        fs.writeFileSync(path.join(distDir, "404.html"), "<!doctype html><html><body>missing page</body></html>");
        const server = await startServer({ use404File: true });

        const response = await requestRaw(server, "/does-not-exist", {
            headers: { "Accept-Encoding": "gzip" },
        });

        expect(response.statusCode).toEqual(404);
        expect(response.statusMessage).toEqual("Not found");
        expect(response.headers["content-encoding"]).toEqual("gzip");
        expect(Number(response.headers["content-length"])).toEqual(response.body.length);
        expect(gunzipSync(response.body).toString()).toContain("missing page");
    });

    it("rejects unsupported methods on static resources", async () => {
        const server = await startServer();

        const response = await requestRaw(server, "/", { method: "POST" });

        expect(response.statusCode).toEqual(405);
        expect(response.headers.allow).toEqual("GET, HEAD");
        expect(response.body.length).toEqual(0);
    });

    it("uses the longest proxy prefix and preserves the query and upstream status", async () => {
        let upstreamUrl = "";
        const upstream = http.createServer((req, res) => {
            upstreamUrl = req.url;
            res.writeHead(206, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("partial proxy response");
        });
        servers.push(upstream);
        await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
        const upstreamAddress = upstream.address();
        const origin = `http://127.0.0.1:${upstreamAddress.port}`;
        const server = await startServer({
            proxy: {
                "/api": `${origin}/general`,
                "/api/private": `${origin}/private-root`,
            },
        });

        const response = await requestRaw(server, "/api/private/item?q=a%20b&x=1");

        expect(response.statusCode).toEqual(206);
        expect(response.headers["content-type"]).toEqual("text/plain; charset=utf-8");
        expect(response.body.toString()).toEqual("partial proxy response");
        expect(upstreamUrl).toEqual("/private-root/item?q=a%20b&x=1");
    });

    it("does not write access log entries when accessLog is false", async () => {
        const httpCalls: any[] = [];
        class LoggerStub {
            http(...args: any[]): void {
                httpCalls.push(args);
            }
            error(): void {}
        }
        const server = await startServer({}, { "./Logger.ts": LoggerStub });

        const response = await requestRaw(server, "/", {
            headers: { "User-Agent": "edge-case-test" },
        });

        expect(response.statusCode).toEqual(200);
        expect(httpCalls).toEqual([]);
        expect(fs.existsSync(path.join(rootDir, "server.log"))).toBeFalse();
    });

    it("maps a proxy saturation error to an empty retryable 503", async () => {
        class LoggerStub {
            http(): void {}
            error(): void {}
        }
        const server = await startServer({ proxy: { "/api": "http://upstream.invalid" } }, {
            "./Logger.ts": LoggerStub,
            "./contentReader.ts": {
                readFile: async () => { throw new Error("Unexpected static read"); },
                readProxy: async () => {
                    const error: any = new Error("Queue full");
                    error.statusCode = 503;
                    throw error;
                },
            },
        });

        const response = await requestRaw(server, "/api/resource");

        expect(response.statusCode).toEqual(503);
        expect(response.statusMessage).toEqual("Service Unavailable");
        expect(response.headers["retry-after"]).toEqual("1");
        expect(response.headers["content-length"]).toEqual("0");
        expect(response.body.length).toEqual(0);
    });

    it("maps a proxy deadline error to an empty 504 without Retry-After", async () => {
        class LoggerStub {
            http(): void {}
            error(): void {}
        }
        const server = await startServer({ proxy: { "/api": "http://upstream.invalid" } }, {
            "./Logger.ts": LoggerStub,
            "./contentReader.ts": {
                readFile: async () => { throw new Error("Unexpected static read"); },
                readProxy: async () => {
                    const error: any = new Error("Upstream deadline");
                    error.statusCode = 504;
                    throw error;
                },
            },
        });

        const response = await requestRaw(server, "/api/resource");

        expect(response.statusCode).toEqual(504);
        expect(response.statusMessage).toEqual("Gateway Timeout");
        expect(response.headers["retry-after"]).toBeUndefined();
        expect(response.headers["content-length"]).toEqual("0");
        expect(response.body.length).toEqual(0);
    });
});
