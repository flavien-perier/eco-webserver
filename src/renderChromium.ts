"use strict";

const { existsSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const puppeteer = require("puppeteer-core");

const configuration = require("./configuration.ts").default;
const getContentType = require("./getContentType.ts");
const { readLocalResource } = require("./rawResourceCache.ts");
const Logger = require("./Logger.ts");

const logger = new Logger();

const CHROMIUM_PATH = configuration.chromiumPath;
const CHROMIUM_CONCURRENCY = Math.max(1, Number(process.env.ECO_CHROMIUM_CONCURRENCY || configuration.chromiumConcurrency) || 2);
const CHROMIUM_MAX_QUEUE = Math.max(0, Number(configuration.chromiumMaxQueue ?? 100));
const CHROMIUM_RENDER_TIMEOUT = Math.max(1, Number(configuration.chromiumRenderTimeout) || 30000);
const CHROMIUM_WAIT_UNTIL = configuration.chromiumWaitUntil || "networkidle0";
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
const renderQueue: any[] = [];

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
 * Acquires a rendering slot, waiting in a bounded queue until the deadline.
 * Timed out entries are removed so they cannot consume a slot later.
 *
 * @param {number} deadline
 * @returns {Promise<void>}
 */
async function acquireRenderSlot(deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Chromium rendering deadline exceeded");

    if (activeRenders < CHROMIUM_CONCURRENCY) {
        activeRenders++;
        return;
    }
    if (renderQueue.length >= CHROMIUM_MAX_QUEUE) throw new Error("Chromium rendering queue is full");

    await new Promise<void>((resolve, reject) => {
        const entry: any = { resolve: null, timer: null };
        entry.resolve = () => {
            clearTimeout(entry.timer);
            resolve();
        };
        entry.timer = setTimeout(() => {
            const index = renderQueue.indexOf(entry);
            if (index !== -1) renderQueue.splice(index, 1);
            reject(new Error("Chromium rendering deadline exceeded while waiting for a slot"));
        }, remaining);
        renderQueue.push(entry);
    });
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
        next.resolve();
    }
}

/**
 * Runs an operation without waiting beyond the absolute rendering deadline.
 * The operation itself may not be cancellable, but its result is ignored on timeout.
 *
 * @param {Function} operation
 * @param {number} deadline
 * @returns {Promise<any>}
 */
async function runBeforeDeadline(operation: Function, deadline: number): Promise<any> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Chromium rendering deadline exceeded");

    let timer: any;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Chromium rendering deadline exceeded")), remaining);
    });

    try {
        return await Promise.race([Promise.resolve().then(operation), timeout]);
    } finally {
        clearTimeout(timer);
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

    const deadline = Date.now() + CHROMIUM_RENDER_TIMEOUT;
    let page;
    let slotAcquired = false;

    try {
        await acquireRenderSlot(deadline);
        slotAcquired = true;
        const browser = await runBeforeDeadline(() => getBrowser(), deadline);
        page = await runBeforeDeadline(() => browser.newPage(), deadline);
        await runBeforeDeadline(() => page.setRequestInterception(true), deadline);

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

        await runBeforeDeadline(() => page.goto(`http://127.0.0.1:${configuration.port}${requestUrl}`, {
            waitUntil: CHROMIUM_WAIT_UNTIL,
            timeout: Math.max(1, deadline - Date.now())
        }), deadline);

        return await runBeforeDeadline(() => page.content(), deadline);
    } catch(err) {
        logger.error("Error during the chromium rendering, isomorphic rendering will use jsdom", err);
        return null;
    } finally {
        if (page) {
            const closing = Promise.resolve().then(() => page.close()).catch(() => {});
            if (Date.now() < deadline) await runBeforeDeadline(() => closing, deadline).catch(() => {});
        }
        if (slotAcquired) releaseRenderSlot();
    }
};
