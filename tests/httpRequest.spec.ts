const http = require("http");
const requestBuffer = require("../src/httpRequest.ts");

describe("httpRequest", () => {
    let server;
    let port;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/slow") {
                setTimeout(() => res.end("late"), 100);
            } else {
                res.end("response body");
            }
        });
        await new Promise(resolve => server.listen(0, resolve));
        port = server.address().port;
    });

    afterAll(async () => {
        await new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
        });
    });

    it("Downloads a response as a buffer", async () => {
        const response = await requestBuffer(new URL(`http://127.0.0.1:${port}/`), 1000, 100);
        expect(response.buffer.toString()).toEqual("response body");
        expect(response.statusCode).toEqual(200);
    });

    it("Rejects responses above the size limit", async () => {
        await expectAsync(requestBuffer(new URL(`http://127.0.0.1:${port}/`), 1000, 4)).toBeRejected();
    });

    it("Rejects requests above the timeout", async () => {
        await expectAsync(requestBuffer(new URL(`http://127.0.0.1:${port}/slow`), 10, 100)).toBeRejected();
    });
});
