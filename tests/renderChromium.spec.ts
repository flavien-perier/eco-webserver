const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "/tmp/eco-test-cache";
const SANDBOX_DIR = "./tests/testDist/chromium";
const RENDERED_HTML = "<html><body>chromium rendered</body></html>";

/**
 * Request intercepted by a fake chromium page.
 */
class FakeRequest {
    constructor(url, isNavigation) {
        this.requestedUrl = url;
        this.isNavigation = isNavigation;
        this.responses = [];
        this.continued = false;
    }

    url() {
        return this.requestedUrl;
    }

    isNavigationRequest() {
        return this.isNavigation;
    }

    async respond(response) {
        this.responses.push(response);
    }

    async continue() {
        this.continued = true;
    }
}

/**
 * Fake chromium page recording the requests it receives.
 */
class FakePage {
    constructor() {
        this.requests = [];
        this.requestHandlers = [];
        this.closeCount = 0;
        this.gotoOptions = null;
    }

    async setRequestInterception() {}

    on(event, handler) {
        this.requestHandlers.push(handler);
    }

    async goto(url, options) {
        this.gotoOptions = options;
        const requests = [new FakeRequest(url, true), new FakeRequest("http://127.0.0.1:8080/script.js", false)];

        for (const request of requests) {
            this.requests.push(request);
            await this.requestHandlers[0](request);
        }
    }

    async content() {
        return RENDERED_HTML;
    }

    async close() {
        this.closeCount++;
    }
}

/**
 * Fake chromium browser recording the pages it creates.
 */
class FakeBrowser {
    constructor() {
        this.pages = [];
    }

    async newPage() {
        const page = new FakePage();
        this.pages.push(page);
        return page;
    }
}

describe("renderChromium", () => {
    /**
     * Stubs the configuration with a given `chromiumPath`.
     */
    const mockConfiguration = (chromiumPath: string, overrides: Record<string, any> = {}) => ({
        "./configuration.ts": {
            default: {
                port: 8080,
                cacheCycle: 1800,
                distDir: SANDBOX_DIR,
                cacheDir: TEST_CACHE,
                logDir: "/dev/null",
                enableIsomorphic: true,
                chromiumPath: chromiumPath,
                header: {},
                contentType: {
                    "html": "text/html",
                    "js": "application/javascript",
                    "text": "text/plain"
                },
                proxy: {},
                use404File: false,
                ...overrides,
            },
            "@global": true,
        }
    });

    beforeEach(() => {
        fs.mkdirSync(TEST_CACHE);
        fs.mkdirSync(SANDBOX_DIR);
        fs.writeFileSync(SANDBOX_DIR + "/script.js", "document.title = \"chromium\";");
    });

    afterEach(() => {
        fs.rmSync(SANDBOX_DIR, { recursive: true });
        fs.rmSync(TEST_CACHE, { recursive: true });
    });

    it("Should render a page with chromium", async () => {
        const browser = new FakeBrowser();
        let launchOptions = null;
        const puppeteer = {
            launch: async options => {
                launchOptions = options;
                return browser;
            }
        };
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": puppeteer,
            ...mockConfiguration("/usr/bin/env")
        });

        const content = "<html><head><title>Chromium</title></head><body><script src=\"./script.js\"></script></body></html>";
        const html = await renderChromium(content, "/index.html");

        expect(html).toEqual(RENDERED_HTML);
        expect(launchOptions.executablePath).toEqual("/usr/bin/env");
        expect(launchOptions.args).toContain("--no-sandbox");

        const page = browser.pages[0];

        expect(page.requests.length).toEqual(2);
        expect(page.requests[0].isNavigation).toBe(true);
        expect(page.requests[0].responses.length).toEqual(1);
        expect(page.requests[0].responses[0].body).toEqual(content);
        expect(page.requests[0].responses[0].contentType).toEqual("text/html");
        expect(page.requests[1].isNavigation).toBe(false);
        expect(page.requests[1].responses.length).toEqual(1);
        expect(page.requests[1].responses[0].body.toString()).toEqual("document.title = \"chromium\";");
        expect(page.requests[1].responses[0].contentType).toEqual("application/javascript");
        expect(page.gotoOptions.waitUntil).toEqual("networkidle0");
        expect(page.gotoOptions.timeout).toBeLessThanOrEqual(30000);
        expect(page.closeCount).toEqual(1);
    });

    it("Should return null when chromium is not installed", async () => {
        let launchCount = 0;
        const puppeteer = {
            launch: async () => {
                launchCount++;
            }
        };
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": puppeteer,
            ...mockConfiguration("/usr/bin/not-found-chromium")
        });

        expect(await renderChromium("<html></html>", "/index.html")).toBeNull();
        expect(launchCount).toEqual(0);
    });

    it("Should return null when chromium fails to launch", async () => {
        const puppeteer = {
            launch: async () => {
                throw new Error("launch error");
            }
        };
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": puppeteer,
            ...mockConfiguration("/usr/bin/env")
        });

        expect(await renderChromium("<html></html>", "/index.html")).toBeNull();
    });

    it("Should configure waitUntil and bound the goto timeout by the rendering deadline", async () => {
        const browser = new FakeBrowser();
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": { launch: async () => browser },
            ...mockConfiguration("/usr/bin/env", {
                chromiumRenderTimeout: 1234,
                chromiumWaitUntil: "domcontentloaded"
            })
        });

        expect(await renderChromium("<html></html>", "/index.html")).toEqual(RENDERED_HTML);
        expect(browser.pages[0].gotoOptions.waitUntil).toEqual("domcontentloaded");
        expect(browser.pages[0].gotoOptions.timeout).toBeLessThanOrEqual(1234);
        expect(browser.pages[0].gotoOptions.timeout).toBeGreaterThan(0);
    });

    it("Should stop waiting when chromium launch exceeds the rendering deadline", async () => {
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": { launch: () => new Promise(() => {}) },
            ...mockConfiguration("/usr/bin/env", { chromiumRenderTimeout: 20 })
        });

        expect(await renderChromium("<html></html>", "/index.html")).toBeNull();
    });

    it("Should recover slots after a rendering and a queued rendering time out", async () => {
        let shouldHang = true;
        let hangingPage;

        class HangingPage extends FakePage {
            async goto() {
                return new Promise(() => {});
            }
        }

        const browser = {
            newPage: async () => {
                if (!shouldHang) return new FakePage();
                hangingPage = new HangingPage();
                return hangingPage;
            }
        };
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": { launch: async () => browser },
            ...mockConfiguration("/usr/bin/env", {
                chromiumConcurrency: 1,
                chromiumRenderTimeout: 30
            })
        });

        const results = await Promise.all([
            renderChromium("<html></html>", "/index.html"),
            renderChromium("<html></html>", "/queued.html")
        ]);
        expect(results).toEqual([null, null]);
        expect(hangingPage.closeCount).toEqual(1);

        shouldHang = false;
        expect(await renderChromium("<html></html>", "/index.html")).toEqual(RENDERED_HTML);
    });

    it("Should recover after a chromium disconnection", async () => {
        class DisconnectableBrowser extends FakeBrowser {
            constructor() {
                super();
                this.failNextPage = true;
            }

            once(event, handler) {
                this.disconnectHandler = handler;
            }

            async newPage() {
                if (this.failNextPage) {
                    this.failNextPage = false;
                    throw new Error("browser disconnected");
                }
                return super.newPage();
            }

            disconnect() {
                this.disconnectHandler();
            }
        }

        const browser = new DisconnectableBrowser();
        let launchCount = 0;
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": { launch: async () => {
                launchCount++;
                return browser;
            } },
            ...mockConfiguration("/usr/bin/env")
        });

        expect(await renderChromium("<html></html>", "/index.html")).toBeNull();
        browser.disconnect();
        expect(await renderChromium("<html></html>", "/index.html")).toEqual(RENDERED_HTML);
        expect(launchCount).toEqual(2);
    });

    it("Should limit concurrent chromium pages", async () => {
        let activePages = 0;
        let maxActivePages = 0;

        class SlowPage extends FakePage {
            async goto() {
                activePages++;
                maxActivePages = Math.max(maxActivePages, activePages);
                await new Promise(resolve => setTimeout(resolve, 20));
                activePages--;
            }
        }

        const browser = {
            newPage: async () => new SlowPage(),
        };
        const renderChromium = proxyquire("../src/renderChromium.ts", {
            "puppeteer-core": { launch: async () => browser },
            ...mockConfiguration("/usr/bin/env", { chromiumConcurrency: 2 })
        });

        await Promise.all(Array.from({ length: 5 }, () => renderChromium("<html></html>", "/index.html")));
        expect(maxActivePages).toEqual(2);
    });
});