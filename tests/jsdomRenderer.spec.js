const fs = require("fs");
const { resolve } = require("path");
const proxyquire = require("proxyquire").noPreserveCache();

const SANDBOX_DIR = "./tests/testDist/jsdom";

const renderJsdom = proxyquire("../src/jsdomRenderer.cts", {
    "./configuration.cts": {
        default: {
            port: 8080,
            distDir: SANDBOX_DIR,
            proxyTimeout: 1000,
            proxyMaxSize: 1024 * 1024,
            scriptTimeout: 1000,
            jsdomConcurrency: 2,
            jsdomMaxQueue: 10,
            jsdomRenderTimeout: 5000,
            scriptLoadConcurrency: 2,
        },
        "@global": true,
    },
});

describe("jsdomRenderer", () => {
    beforeEach(() => {
        fs.mkdirSync(resolve(SANDBOX_DIR), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(resolve(SANDBOX_DIR), { recursive: true, force: true });
    });

    it("Should serialize HTML without scripts without waiting for stability", async () => {
        const html = await renderJsdom(
            "<!doctype html><html><body><main>Static content</main></body></html>",
            "/index.html"
        );

        expect(html).toContain("<main>Static content</main>");
    });

    it("Should wait for a deferred DOM mutation", async () => {
        const html = await renderJsdom(
            `<html><body>
                <div id="result">initial</div>
                <script>
                    setTimeout(() => {
                        document.getElementById("result").textContent = "updated";
                    }, 25);
                </script>
            </body></html>`,
            "/index.html"
        );

        expect(html).toContain('<div id="result">updated</div>');
    });

    it("Should execute a local script read raw from distDir", async () => {
        fs.writeFileSync(resolve(SANDBOX_DIR, "raw.js"), `function rawLocalScript() {
    // raw-local-script-marker
    return "raw";
}
document.getElementById("result").textContent = rawLocalScript.toString();`);

        const html = await renderJsdom(
            '<html><body><pre id="result"></pre><script src="./raw.js"></script></body></html>',
            "/index.html"
        );

        expect(html).toContain("raw-local-script-marker");
        expect(html).toContain("function rawLocalScript()");
    });
});
