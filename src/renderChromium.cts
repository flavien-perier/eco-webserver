"use strict";

const { existsSync } = require("fs");
const { lstat, readFile } = require("fs/promises");
const { resolve, sep, join } = require("path");
const { tmpdir } = require("os");

const puppeteer = require("puppeteer-core");

const configuration = require("./configuration.cts").default;
const getContentType = require("./getContentType.cts");
const Logger = require("./Logger.cts");

const logger = new Logger();

const CHROMIUM_PATH = configuration.chromiumPath;
const CHROMIUM_CONCURRENCY = Math.max(1, Number(process.env.ECO_CHROMIUM_CONCURRENCY || configuration.chromiumConcurrency) || 2);
const CHROMIUM_MAX_QUEUE = Math.max(0, Number(configuration.chromiumMaxQueue ?? 100));
const CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    // Chromium run as a non-root user cannot create its user data directory.
    `--user-data-dir=${join(tmpdir(), `eco-webserver-chromium-${process.pid}`)}`
];

let hasLoggedMissingChromium = false;
let browserPromise: Promise<any> | null = null;
let activeRenders = 0;
const renderQueue: Function[] = [];

/**
 * Returns the shared chromium browser instance.
 *
 * @returns {Promise<any>}
 */
async function getBrowser(): Promise<any> {
    if (!browserPromise) {
        const launching = puppeteer.launch({
            executablePath: CHROMIUM_PATH,
            headless: true,
            args: CHROMIUM_ARGS
        }).then(browser => {
            if (typeof browser.once === "function") {
                browser.once("disconnected", () => {
                    if (browserPromise === launching) browserPromise = null;
                });
            }
            return browser;
        }).catch(err => {
            if (browserPromise === launching) browserPromise = null;
            throw err;
        });
        browserPromise = launching;
    }

    return browserPromise;
}

/**
 * Acquires a rendering slot, waiting in a bounded queue when necessary.
 *
 * @returns {Promise<void>}
 */
async function acquireRenderSlot(): Promise<void> {
    if (activeRenders >= CHROMIUM_CONCURRENCY) {
        if (renderQueue.length >= CHROMIUM_MAX_QUEUE) throw new Error("Chromium rendering queue is full");
        await new Promise(resolve => renderQueue.push(resolve));
    }
    activeRenders++;
}

/**
 * Releases a rendering slot and wakes the next queued rendering.
 *
 * @returns {void}
 */
function releaseRenderSlot(): void {
    activeRenders--;
    const next = renderQueue.shift();
    if (next) {
        activeRenders++;
        next();
    }
}

/**
 * Reads a local sub-resource without following paths outside distDir.
 *
 * @param {string} pathname
 * @returns {Promise<Buffer | null>}
 */
async function readLocalResource(pathname: string): Promise<Buffer | null> {
    const distDir = resolve(configuration.distDir);
    const filePath = resolve(distDir, `.${decodeURIComponent(pathname)}`);
    if (filePath !== distDir && !filePath.startsWith(distDir + sep)) return null;

    try {
        if (!(await lstat(filePath)).isFile()) return null;
        return await readFile(filePath);
    } catch(err) {
        if (err.code === "ENOENT") return null;
        throw err;
    }
}

/**
 * Renders a html page with chromium before sending it to the client.
 * Returns `null` if chromium is not usable, in this case the caller must fallback on jsdom.
 *
 * @param {string} content
 * @param {string} requestUrl
 * @returns {Promise<string | null>}
 */
module.exports = async function renderChromium(content: string, requestUrl: string): Promise<string | null> {
    if (!CHROMIUM_PATH || !existsSync(CHROMIUM_PATH)) {
        if (!hasLoggedMissingChromium) {
            hasLoggedMissingChromium = true;
            logger.info("Chromium is not available, isomorphic rendering will use jsdom");
        }

        return null;
    }

    let page;
    let slotAcquired = false;

    try {
        await acquireRenderSlot();
        slotAcquired = true;
        const browser = await getBrowser();
        page = await browser.newPage();
        await page.setRequestInterception(true);

        let isDocumentServed = false;

        page.on("request", async request => {
            try {
                if (!isDocumentServed && request.isNavigationRequest()) {
                    isDocumentServed = true;
                    await request.respond({ status: 200, contentType: "text/html", body: content });
                    return;
                }

                const requestedUrl = new URL(request.url());

                if (requestedUrl.hostname !== "127.0.0.1") {
                    await request.continue();
                    return;
                }

                const body = await readLocalResource(requestedUrl.pathname);
                if (body) {
                    await request.respond({
                        status: 200,
                        contentType: getContentType(requestedUrl.pathname),
                        body
                    });
                } else {
                    await request.respond({ status: 404, contentType: "text/plain", body: "Not found" });
                }
            } catch(err) {
                logger.error("Error intercepting a chromium request", err);
                if (typeof request.abort === "function") await request.abort().catch(() => {});
            }
        });

        await page.goto(`http://127.0.0.1:${configuration.port}${requestUrl}`, { waitUntil: "networkidle0", timeout: 30000 });

        return await page.content();
    } catch(err) {
        logger.error("Error during the chromium rendering, isomorphic rendering will use jsdom", err);
        return null;
    } finally {
        if (page) await page.close().catch(() => {});
        if (slotAcquired) releaseRenderSlot();
    }
};
