"use strict";

const { existsSync, readFileSync } = require("fs");
const { join } = require("path");

const puppeteer = require("puppeteer-core");

const configuration = require("./configuration").default;
const getContentType = require("./getContentType");
const Logger = require("./Logger");

const logger = new Logger();

const CHROMIUM_PATH = configuration.chromiumPath;
const CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu"
];

/**
 * Indicates if the absence of chromium has already been logged.
 *
 * @type {boolean}
 */
let hasLoggedMissingChromium = false;

/**
 * Promise of the chromium browser shared by all renderings.
 *
 * @type {Promise<any> | null}
 */
let browserPromise = null;

/**
 * Returns the shared chromium browser instance.
 *
 * @returns {Promise<any>}
 */
async function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({
            executablePath: CHROMIUM_PATH,
            headless: true,
            args: CHROMIUM_ARGS
        }).catch(err => {
            browserPromise = null;
            throw err;
        });
    }

    return browserPromise;
}

/**
 * Renders a html page with chromium before sending it to the client.
 * Returns `null` if chromium is not usable, in this case the caller must fallback on jsdom.
 *
 * @param {string} content
 * @param {string} requestUrl
 * @returns {Promise<string | null>}
 */
module.exports = async function renderChromium(content, requestUrl) {
    if (!CHROMIUM_PATH || !existsSync(CHROMIUM_PATH)) {
        if (!hasLoggedMissingChromium) {
            hasLoggedMissingChromium = true;
            logger.info("Chromium is not available, isomorphic rendering will use jsdom");
        }

        return null;
    }

    let browser;

    try {
        browser = await getBrowser();
    } catch(err) {
        logger.error("Chromium is not usable, isomorphic rendering will use jsdom", err);
        return null;
    }

    const page = await browser.newPage();

    try {
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

                const filePath = join(configuration.distDir, requestedUrl.pathname);

                if (existsSync(filePath)) {
                    await request.respond({
                        status: 200,
                        contentType: getContentType(requestedUrl.pathname),
                        body: readFileSync(filePath)
                    });
                } else {
                    await request.respond({ status: 404, contentType: "text/plain", body: "Not found" });
                }
            } catch(err) {
                logger.error("Error intercepting a chromium request", err);
            }
        });

        await page.goto(`http://127.0.0.1:${configuration.port}${requestUrl}`, { waitUntil: "networkidle0", timeout: 30000 });

        return await page.content();
    } catch(err) {
        logger.error("Error during the chromium rendering, isomorphic rendering will use jsdom", err);
        return null;
    } finally {
        await page.close().catch(() => {});
    }
}