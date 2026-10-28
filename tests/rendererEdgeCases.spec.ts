const fs = require("fs");
const { resolve } = require("path");
const proxyquire = require("proxyquire").noPreserveCache();

const SANDBOX_DIR = "./tests/testDist/renderer-edge";
const RENDERED_HTML = "<html><body>rendered by chromium</body></html>";

function loadJsdom(overrides: Record<string, any> = {}) {
    return proxyquire("../src/jsdomRenderer.ts", {
        "./configuration.ts": {
            default: {
                port: 8080,
                distDir: SANDBOX_DIR,
                proxyTimeout: 50,
                proxyMaxSize: 1024 * 1024,
                scriptTimeout: 50,
                jsdomConcurrency: 1,
                jsdomMaxQueue: 4,
                jsdomRenderTimeout: 5000,
                scriptLoadConcurrency: 2,
                ...overrides,
            },
            "@global": true,
        },
    });
}

function configurationStub(overrides: Record<string, any> = {}) {
    return {
        "./configuration.ts": {
            default: {
                port: 8080,
                distDir: SANDBOX_DIR,
                logDir: "/dev/null",
                chromiumPath: "/usr/bin/env",
                chromiumConcurrency: 1,
                chromiumMaxQueue: 4,
                chromiumRenderTimeout: 100,
                chromiumWaitUntil: "networkidle0",
                rawCacheMaxEntries: 10,
                rawCacheMaxSize: 1024 * 1024,
                ...overrides,
            },
            "@global": true,
        },
    };
}

class SilentLogger {
    info() {}
    error() {}
}

function createPage(overrides: Record<string, any> = {}) {
    return Object.assign({
        closeCount: 0,
        requestHandler: null,
        async setRequestInterception() {},
        on(event, handler) {
            if (event === "request") this.requestHandler = handler;
        },
        async goto() {},
        async content() {
            return RENDERED_HTML;
        },
        async close() {
            this.closeCount++;
        },
    }, overrides);
}

function loadChromium(browser: any, overrides: Record<string, any> = {}) {
    return proxyquire("../src/renderChromium.ts", {
        "puppeteer-core": { launch: async () => browser },
        "./Logger.ts": SilentLogger,
        ...configurationStub(overrides),
    });
}

class FakeRequest {
    requestedUrl: string;
    navigation: boolean;
    responses: any[] = [];
    continued: boolean = false;
    aborted: boolean = false;

    constructor(url: string, navigation: boolean) {
        this.requestedUrl = url;
        this.navigation = navigation;
    }

    url() {
        return this.requestedUrl;
    }

    isNavigationRequest() {
        return this.navigation;
    }

    async respond(response: any) {
        this.responses.push(response);
    }

    async continue() {
        this.continued = true;
    }

    async abort() {
        this.aborted = true;
    }
}

describe("jsdomRenderer edge cases", () => {
    beforeEach(() => {
        fs.mkdirSync(resolve(SANDBOX_DIR), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(resolve(SANDBOX_DIR), { recursive: true, force: true });
    });

    it("serializes an empty document", async () => {
        const renderJsdom = loadJsdom();

        expect(await renderJsdom("", "/empty.html")).toBe("<html><head></head><body></body></html>");
    });

    it("executes inline and external scripts in document order", async () => {
        fs.writeFileSync(resolve(SANDBOX_DIR, "first.js"), `window.steps.push("external-1");`);
        fs.writeFileSync(resolve(SANDBOX_DIR, "second.js"), `window.steps.push("external-2");`);
        const renderJsdom = loadJsdom();
        const html = await renderJsdom(`<html><body>
            <pre id="result"></pre>
            <script>window.steps = ["inline-1"];</script>
            <script src="./first.js"></script>
            <script>window.steps.push("inline-2");</script>
            <script src="./second.js"></script>
            <script>document.getElementById("result").textContent = window.steps.join(",");</script>
        </body></html>`, "/index.html");

        expect(html).toContain('<pre id="result">inline-1,external-1,inline-2,external-2</pre>');
    });

    it("ignores a missing local script and runs the following script", async () => {
        const renderJsdom = loadJsdom();
        const html = await renderJsdom(`<html><body>
            <div id="result">initial</div>
            <script src="./missing.js"></script>
            <script>document.getElementById("result").textContent = "continued";</script>
        </body></html>`, "/index.html");

        expect(html).toContain('<div id="result">continued</div>');
    });

    it("continues after syntax and runtime script errors", async () => {
        const renderJsdom = loadJsdom();
        const html = await renderJsdom(`<html><body>
            <div id="result">initial</div>
            <script>const broken = ;</script>
            <script>throw new Error("expected runtime error");</script>
            <script>document.getElementById("result").textContent = "recovered";</script>
        </body></html>`, "/index.html");

        expect(html).toContain('<div id="result">recovered</div>');
    });

    it("bounds an individual script and executes the next one", async () => {
        const renderJsdom = loadJsdom({ scriptTimeout: 25 });
        const html = await renderJsdom(`<html><body>
            <div id="result">initial</div>
            <script>while (true) {}</script>
            <script>document.getElementById("result").textContent = "after timeout";</script>
        </body></html>`, "/index.html");

        expect(html).toContain('<div id="result">after timeout</div>');
    });

    it("bounds continuous DOM mutations and closes their timers", async () => {
        const renderJsdom = loadJsdom();
        const startedAt = Date.now();
        const html = await renderJsdom(`<html><body>
            <div id="result">0</div>
            <script>
                let mutationCount = 0;
                setInterval(() => {
                    mutationCount++;
                    document.getElementById("result").textContent = String(mutationCount);
                }, 20);
            </script>
        </body></html>`, "/continuous.html");

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1800);
        expect(Date.now() - startedAt).toBeLessThan(5000);
        expect(html).not.toContain('<div id="result">0</div>');
        expect(await renderJsdom("<html><body>after close</body></html>", "/after.html")).toContain("after close");
    });

    it("preserves Unicode text and attribute encodings", async () => {
        const renderJsdom = loadJsdom();
        const html = await renderJsdom(
            '<html><body><p title="café &amp; crème">Les tests 😀 — 東京</p></body></html>',
            "/unicode.html"
        );

        expect(html).toContain("Les tests 😀 — 東京");
        expect(html).toContain('title="café &amp; crème"');
    });

    it("rejects at the global deadline with a gateway timeout status", async () => {
        const renderJsdom = loadJsdom({ scriptTimeout: 5000, jsdomRenderTimeout: 40 });
        const error = await renderJsdom(
            "<html><body><script>while (true) {}</script></body></html>",
            "/deadline.html"
        ).then(() => null, err => err);

        expect(error).toEqual(jasmine.any(Error));
        expect(error.statusCode).toBe(504);
        expect(error.message).toContain("timed out");
    });

    it("rejects immediately with a zero-length queue and reuses the pool", async () => {
        const renderJsdom = loadJsdom({ jsdomMaxQueue: 0 });
        const first = renderJsdom(`<html><body>
            <div id="result">initial</div>
            <script>setTimeout(() => document.getElementById("result").textContent = "done", 20);</script>
        </body></html>`, "/first.html");
        const overflow = await renderJsdom("<html></html>", "/overflow.html").then(() => null, err => err);

        expect(overflow.statusCode).toBe(503);
        expect(overflow.message).toBe("jsdom rendering queue is full");
        expect(await first).toContain('<div id="result">done</div>');
        expect(await renderJsdom("<html><body>next</body></html>", "/next.html")).toContain("next");
    });
});

describe("renderChromium edge cases", () => {
    beforeEach(() => {
        fs.mkdirSync(resolve(SANDBOX_DIR), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(resolve(SANDBOX_DIR), { recursive: true, force: true });
    });

    it("rejects a full zero-length queue without losing the active slot", async () => {
        let releaseContent;
        const contentGate = new Promise(resolveGate => releaseContent = resolveGate);
        const page = createPage({ content: () => contentGate });
        const renderChromium = loadChromium({ newPage: async () => page }, { chromiumMaxQueue: 0 });

        const first = renderChromium("<html></html>", "/first.html");
        expect(await renderChromium("<html></html>", "/overflow.html")).toBeNull();
        releaseContent(RENDERED_HTML);
        expect(await first).toBe(RENDERED_HTML);
        expect(await renderChromium("<html></html>", "/next.html")).toBe(RENDERED_HTML);
    });

    it("honors the deadline while creating a page", async () => {
        const renderChromium = loadChromium(
            { newPage: () => new Promise(() => {}) },
            { chromiumRenderTimeout: 20 }
        );

        expect(await renderChromium("<html></html>", "/new-page.html")).toBeNull();
    });

    it("honors the deadline during navigation and still closes the page", async () => {
        const page = createPage({ goto: () => new Promise(() => {}) });
        const renderChromium = loadChromium(
            { newPage: async () => page },
            { chromiumRenderTimeout: 20 }
        );

        expect(await renderChromium("<html></html>", "/goto.html")).toBeNull();
        expect(page.closeCount).toBe(1);
    });

    it("honors the deadline while reading content and still closes the page", async () => {
        const page = createPage({ content: () => new Promise(() => {}) });
        const renderChromium = loadChromium(
            { newPage: async () => page },
            { chromiumRenderTimeout: 20 }
        );

        expect(await renderChromium("<html></html>", "/content.html")).toBeNull();
        expect(page.closeCount).toBe(1);
    });

    it("falls back when creating a page rejects", async () => {
        const renderChromium = loadChromium({
            newPage: async () => {
                throw new Error("newPage failed");
            },
        });

        expect(await renderChromium("<html></html>", "/new-page-error.html")).toBeNull();
    });

    it("falls back and closes the page when navigation rejects", async () => {
        const page = createPage({
            goto: async () => {
                throw new Error("goto failed");
            },
        });
        const renderChromium = loadChromium({ newPage: async () => page });

        expect(await renderChromium("<html></html>", "/goto-error.html")).toBeNull();
        expect(page.closeCount).toBe(1);
    });

    it("falls back and closes the page when reading content rejects", async () => {
        const page = createPage({
            content: async () => {
                throw new Error("content failed");
            },
        });
        const renderChromium = loadChromium({ newPage: async () => page });

        expect(await renderChromium("<html></html>", "/content-error.html")).toBeNull();
        expect(page.closeCount).toBe(1);
    });

    it("returns rendered content when closing the page rejects", async () => {
        const page = createPage({
            close: async () => {
                throw new Error("close failed");
            },
        });
        const renderChromium = loadChromium({ newPage: async () => page });

        expect(await renderChromium("<html></html>", "/close-error.html")).toBe(RENDERED_HTML);
    });

    it("continues external requests and returns 404 for missing local resources", async () => {
        const external = new FakeRequest("https://example.com/external.js", false);
        const missing = new FakeRequest("http://127.0.0.1:8080/missing.js", false);
        const page = createPage({
            goto: async () => {
                await page.requestHandler(external);
                await page.requestHandler(missing);
            },
        });
        const renderChromium = loadChromium({ newPage: async () => page });

        expect(await renderChromium("<html></html>", "/resources.html")).toBe(RENDERED_HTML);
        expect(external.continued).toBeTrue();
        expect(external.responses.length).toBe(0);
        expect(missing.responses.length).toBe(1);
        expect(missing.responses[0].status).toBe(404);
        expect(missing.responses[0].body).toBe("Not found");
    });
});
