"use strict";

const { parentPort } = require("worker_threads");
const { readFile } = require("fs/promises");
const { resolve, sep } = require("path");
const { Script } = require("vm");

const jsdom = require("jsdom");
const requestBuffer = require("./httpRequest.cts");

const QUIET_PERIOD = 100;
const STABILITY_TIMEOUT = 2000;

/**
 * Loads items concurrently without changing their result order.
 *
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} loader
 * @returns {Promise<Array>}
 */
async function loadOrdered(items: any[], concurrency: number, loader: Function): Promise<any[]> {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await loader(items[index]);
        }
    }

    const consumers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => consume()
    );
    await Promise.all(consumers);
    return results;
}

/**
 * Reads a local script directly from distDir, without using the resource cache.
 *
 * @param {URL} scriptUrl
 * @param {string} distDir
 * @returns {Promise<string>}
 */
async function readLocalScript(scriptUrl: URL, distDir: string): Promise<string> {
    const pathname = decodeURIComponent(scriptUrl.pathname);
    const filePath = resolve(distDir, `.${pathname}`);
    if (filePath !== distDir && !filePath.startsWith(distDir + sep)) {
        throw new Error("Invalid script path");
    }

    return readFile(filePath, "utf8");
}

/**
 * Loads a script source, returning an empty script when loading fails.
 *
 * @param {any} script
 * @param {URL} documentUrl
 * @param {Object} configuration
 * @returns {Promise<string>}
 */
async function loadScript(script: any, documentUrl: URL, configuration: any): Promise<string> {
    const scriptSrc = script.getAttribute("src");
    if (!scriptSrc) return script.innerHTML;

    try {
        const scriptUrl = new URL(scriptSrc, documentUrl);
        if (scriptUrl.origin === documentUrl.origin) {
            return await readLocalScript(scriptUrl, configuration.distDir);
        }

        if (scriptUrl.protocol === "http:" || scriptUrl.protocol === "https:") {
            const response = await requestBuffer(
                scriptUrl,
                configuration.proxyTimeout,
                configuration.proxyMaxSize
            );
            return response.buffer.toString("utf8");
        }
    } catch(err) {
        return "";
    }

    return "";
}

/**
 * Waits for a quiet period after the last DOM mutation, with a hard deadline.
 *
 * @param {any} window
 * @returns {Promise<void>}
 */
function waitForStableDom(window: any): Promise<void> {
    return new Promise(resolveStability => {
        let quietTimer: any = null;
        let finished = false;

        const finish = (): void => {
            if (finished) return;
            finished = true;
            window.clearTimeout(quietTimer);
            window.clearTimeout(stabilityTimer);
            observer.disconnect();
            resolveStability();
        };

        const observer = new window.MutationObserver(() => {
            window.clearTimeout(quietTimer);
            quietTimer = window.setTimeout(finish, QUIET_PERIOD);
        });
        const stabilityTimer = window.setTimeout(finish, STABILITY_TIMEOUT);

        observer.observe(window.document, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
        });
        quietTimer = window.setTimeout(finish, QUIET_PERIOD);
    });
}

/**
 * Executes a rendering entirely inside the worker.
 *
 * @param {string} content
 * @param {string} requestUrl
 * @param {Object} configuration
 * @returns {Promise<string>}
 */
async function render(content: string, requestUrl: string, configuration: any): Promise<string> {
    const documentUrl = new URL(requestUrl, `http://127.0.0.1:${configuration.port}`);
    const virtualConsole = new jsdom.VirtualConsole();
    const dom = new jsdom.JSDOM(content, {
        url: documentUrl.href,
        referrer: documentUrl.href,
        contentType: "text/html",
        virtualConsole,
        runScripts: "outside-only",
    });

    try {
        const scripts = [...dom.window.document.getElementsByTagName("script")];
        if (scripts.length > 0) {
            const sources = await loadOrdered(
                scripts,
                configuration.scriptLoadConcurrency,
                (script: any) => loadScript(script, documentUrl, configuration)
            );
            const vmContext = dom.getInternalVMContext();

            for (const source of sources) {
                try {
                    new Script(source).runInContext(vmContext, {
                        timeout: configuration.scriptTimeout,
                    });
                } catch(err) {
                    // A failing script must not prevent the remaining scripts or serialization.
                }
            }

            await waitForStableDom(dom.window);
        }

        return dom.serialize();
    } finally {
        dom.window.close();
    }
}

if (parentPort) {
    parentPort.on("message", async message => {
        try {
            const html = await render(message.content, message.requestUrl, message.configuration);
            parentPort.postMessage({ html });
        } catch(err) {
            parentPort.postMessage({
                error: {
                    message: err.message,
                    stack: err.stack,
                },
            });
        }
    });
}
