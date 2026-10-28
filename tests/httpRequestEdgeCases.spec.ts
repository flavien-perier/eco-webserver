const http = require("http");
const net = require("net");
const { once } = require("events");
const requestBuffer = require("../src/httpRequest.ts");

describe("httpRequest edge cases", () => {
    let server;
    let port;
    let sockets;
    let timers;

    beforeEach(async () => {
        sockets = new Set();
        timers = new Set();
        server = http.createServer();
        server.on("connection", socket => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        port = server.address().port;
    });

    afterEach(async () => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();

        if (server.listening) {
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            for (const socket of sockets) socket.destroy();
            await closed;
        } else {
            for (const socket of sockets) socket.destroy();
        }
    });

    function request(path: string = "/", timeout: number = 1000, maxSize: number = 1024 * 1024) {
        return requestBuffer(new URL(`http://127.0.0.1:${port}${path}`), timeout, maxSize);
    }

    function endLater(response, body: string, delay: number) {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!response.destroyed) response.end(body);
        }, delay);
        timers.add(timer);
        response.on("close", () => {
            clearTimeout(timer);
            timers.delete(timer);
        });
    }

    it("resolves an empty response with an empty buffer", async () => {
        server.on("request", (req, res) => res.end());

        const response = await request();

        expect(response.statusCode).toBe(200);
        expect(response.buffer).toEqual(Buffer.alloc(0));
    });

    it("reassembles a chunked response", async () => {
        server.on("request", (req, res) => {
            res.write("first chunk;");
            res.write(" second chunk");
            res.end();
        });

        const response = await request();

        expect(response.buffer.toString()).toBe("first chunk; second chunk");
        expect(response.headers["transfer-encoding"]).toBe("chunked");
    });

    it("preserves multibyte unicode split across chunks", async () => {
        const body = Buffer.from("Avant 🌍 après — 東京");
        server.on("request", (req, res) => {
            const emojiStart = body.indexOf(Buffer.from("🌍"));
            res.write(body.subarray(0, emojiStart + 2));
            res.write(body.subarray(emojiStart + 2));
            res.end();
        });

        const response = await request();

        expect(response.buffer).toEqual(body);
        expect(response.buffer.toString()).toBe("Avant 🌍 après — 東京");
    });

    it("preserves arbitrary binary bytes", async () => {
        const body = Buffer.from([0, 255, 1, 128, 10, 13, 0, 42]);
        server.on("request", (req, res) => res.end(body));

        const response = await request();

        expect(response.buffer).toEqual(body);
    });

    it("resolves non-success status codes without rejecting", async () => {
        server.on("request", (req, res) => {
            res.statusCode = Number(req.url.slice(1));
            res.end("status body");
        });

        const notFound = await request("/404");
        const unavailable = await request("/503");

        expect(notFound.statusCode).toBe(404);
        expect(notFound.buffer.toString()).toBe("status body");
        expect(unavailable.statusCode).toBe(503);
    });

    it("returns the response headers", async () => {
        server.on("request", (req, res) => {
            res.writeHead(200, {
                "Content-Type": "application/octet-stream",
                "X-Edge-Case": "present",
            });
            res.end("headers");
        });

        const response = await request();

        expect(response.headers["content-type"]).toBe("application/octet-stream");
        expect(response.headers["x-edge-case"]).toBe("present");
    });

    it("accepts a response whose size is exactly maxSize", async () => {
        const body = Buffer.alloc(8192, 0x5a);
        server.on("request", (req, res) => res.end(body));

        const response = await request("/", 1000, body.length);

        expect(response.buffer.length).toBe(body.length);
        expect(response.buffer).toEqual(body);
    });

    it("rejects and destroys a response exceeding maxSize", async () => {
        let responseClosed;
        const closed = new Promise(resolve => responseClosed = resolve);
        server.on("request", (req, res) => {
            res.on("close", responseClosed);
            res.end("12345678");
        });

        await expectAsync(request("/", 1000, 7)).toBeRejectedWithError("Remote response exceeds 7 bytes");
        await closed;
    });

    it("rejects on timeout and cleans up the pending response", async () => {
        let response;
        const closed = new Promise(resolve => {
            server.on("request", (req, res) => {
                response = res;
                res.on("close", resolve);
                endLater(res, "too late", 500);
            });
        });

        await expectAsync(request("/", 40, 100)).toBeRejectedWithError("Remote request timed out after 40 ms");
        await closed;
        expect(response.destroyed).toBeTrue();
        expect(timers.size).toBe(0);
    });

    it("rejects when the connection closes before a response", async () => {
        server.on("request", (req, res) => res.socket.end());

        await expectAsync(request()).toBeRejectedWithError(Error);
    });

    it("rejects when the connection is reset before a response", async () => {
        server.on("request", (req, res) => res.socket.resetAndDestroy());

        await expectAsync(request()).toBeRejectedWithError(Error);
    });

    it("rejects an invalid URL instead of throwing outside the promise", async () => {
        await expectAsync(requestBuffer("not a valid URL" as URL, 1000, 100)).toBeRejectedWithError(TypeError);
    });

    it("rejects a connection to a refused port", async () => {
        const unusedServer = net.createServer();
        unusedServer.listen(0, "127.0.0.1");
        await once(unusedServer, "listening");
        const unusedPort = unusedServer.address().port;
        await new Promise(resolve => unusedServer.close(resolve));

        await expectAsync(requestBuffer(new URL(`http://127.0.0.1:${unusedPort}/`), 1000, 100)).toBeRejectedWithError(Error);
    });

    it("returns an HTTP redirect without following it", async () => {
        let targetRequests = 0;
        server.on("request", (req, res) => {
            if (req.url === "/target") {
                targetRequests++;
                res.end("target");
            } else {
                res.writeHead(302, { Location: "/target" });
                res.end();
            }
        });

        const response = await request("/redirect");

        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe("/target");
        expect(response.buffer).toEqual(Buffer.alloc(0));
        expect(targetRequests).toBe(0);
    });
});
