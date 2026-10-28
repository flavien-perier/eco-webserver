"use strict";

const { existsSync, copyFileSync } = require("fs");
const { join } = require("path");

import type { Configuration } from "./types.cts";

const CONF_DIR = join(process.cwd(), "ecoconf.js");

if (!existsSync(CONF_DIR)) {
    copyFileSync(join(__dirname, "ecoconf.js"), CONF_DIR);
}

const ecoconf = require(CONF_DIR);

const DIST_DIR = process.env.ECO_DIST_DIR || ecoconf.distDir || "dist";

const CHROMIUM_CANDIDATES = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable"
];
const DEFAULT_CHROMIUM_PATH = CHROMIUM_CANDIDATES.find(path => existsSync(path)) || null;

/**
 * Validates a finite numeric setting at startup instead of silently disabling
 * resource limits or creating pathological timers.
 *
 * @param {string} name
 * @param {any} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {boolean} integer
 * @returns {number}
 */
function numberSetting(name: string, value: any, fallback: number, minimum: number = 0, integer: boolean = true): number {
    const selected = value ?? fallback;
    const result = Number(selected);
    if (!Number.isFinite(result) || result < minimum || (integer && !Number.isInteger(result))) {
        throw new Error(`Invalid configuration ${name}: expected a finite ${integer ? "integer" : "number"} >= ${minimum}`);
    }
    return result;
}

/**
 * Reads a boolean environment variable with explicit accepted values.
 *
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function booleanSetting(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
    if (["0", "false", "no"].includes(value.toLowerCase())) return false;
    throw new Error(`Invalid boolean environment value: ${value}`);
}

module.exports.default = {
    /**
     * @type {string | number}
     */
    port: process.env.ECO_PORT || ecoconf.port || 8080,

    cacheCycle: numberSetting("cacheCycle", process.env.ECO_CACHE_CYCLE ?? ecoconf.cacheCycle, 1800, 0.001, false),

    /**
     * @type {string}
     */
    distDir: DIST_DIR,

    /**
     * @type {string}
     */
    cacheDir: process.env.ECO_CACHE_DIR || ecoconf.cacheDir || "/tmp/eco-webserver",

    cacheMaxEntries: numberSetting("cacheMaxEntries", process.env.ECO_CACHE_MAX_ENTRIES ?? ecoconf.cacheMaxEntries, 1000, 1),
    cacheMaxSize: numberSetting("cacheMaxSize", process.env.ECO_CACHE_MAX_SIZE ?? ecoconf.cacheMaxSize, 100 * 1024 * 1024, 1),
    cacheValidationInterval: numberSetting("cacheValidationInterval", ecoconf.cacheValidationInterval, 60 * 1000, 1),

    diskCacheMaxSize: numberSetting("diskCacheMaxSize", process.env.ECO_DISK_CACHE_MAX_SIZE ?? ecoconf.diskCacheMaxSize, 512 * 1024 * 1024, 1),
    diskCacheCleanupInterval: numberSetting("diskCacheCleanupInterval", ecoconf.diskCacheCleanupInterval, 60 * 60 * 1000, 0),
    diskWriteConcurrency: numberSetting("diskWriteConcurrency", ecoconf.diskWriteConcurrency, 2, 1),
    diskWriteMaxQueue: numberSetting("diskWriteMaxQueue", ecoconf.diskWriteMaxQueue, 100, 0),

    proxyTimeout: numberSetting("proxyTimeout", process.env.ECO_PROXY_TIMEOUT ?? ecoconf.proxyTimeout, 10000, 1),
    proxyMaxSize: numberSetting("proxyMaxSize", process.env.ECO_PROXY_MAX_SIZE ?? ecoconf.proxyMaxSize, 50 * 1024 * 1024, 1),
    scriptTimeout: numberSetting("scriptTimeout", ecoconf.scriptTimeout, 1000, 1),
    scriptLoadConcurrency: numberSetting("scriptLoadConcurrency", ecoconf.scriptLoadConcurrency, 8, 1),

    processingConcurrency: numberSetting("processingConcurrency", ecoconf.processingConcurrency, 4, 1),
    processingMaxQueue: numberSetting("processingMaxQueue", ecoconf.processingMaxQueue, 100, 0),
    compressionPoolSize: numberSetting("compressionPoolSize", process.env.ECO_COMPRESSION_POOL_SIZE ?? ecoconf.compressionPoolSize, 4, 1),
    compressionMaxQueue: numberSetting("compressionMaxQueue", process.env.ECO_COMPRESSION_MAX_QUEUE ?? ecoconf.compressionMaxQueue, 100, 0),
    cpuPoolSize: numberSetting("cpuPoolSize", process.env.ECO_CPU_POOL_SIZE ?? ecoconf.cpuPoolSize, 2, 1),
    cpuMaxQueue: numberSetting("cpuMaxQueue", ecoconf.cpuMaxQueue, 100, 0),
    cpuWorkerThreshold: numberSetting("cpuWorkerThreshold", process.env.ECO_CPU_WORKER_THRESHOLD ?? ecoconf.cpuWorkerThreshold, 64 * 1024, 0),

    chromiumConcurrency: numberSetting("chromiumConcurrency", process.env.ECO_CHROMIUM_CONCURRENCY ?? ecoconf.chromiumConcurrency, 2, 1),
    chromiumMaxQueue: numberSetting("chromiumMaxQueue", process.env.ECO_CHROMIUM_MAX_QUEUE ?? ecoconf.chromiumMaxQueue, 100, 0),
    chromiumRenderTimeout: numberSetting("chromiumRenderTimeout", ecoconf.chromiumRenderTimeout, 30000, 1),
    chromiumWaitUntil: ecoconf.chromiumWaitUntil || "networkidle0",

    jsdomConcurrency: numberSetting("jsdomConcurrency", process.env.ECO_JSDOM_CONCURRENCY ?? ecoconf.jsdomConcurrency, 2, 1),
    jsdomMaxQueue: numberSetting("jsdomMaxQueue", ecoconf.jsdomMaxQueue, 100, 0),
    jsdomRenderTimeout: numberSetting("jsdomRenderTimeout", ecoconf.jsdomRenderTimeout, 10000, 1),

    rawCacheMaxEntries: numberSetting("rawCacheMaxEntries", ecoconf.rawCacheMaxEntries, 500, 1),
    rawCacheMaxSize: numberSetting("rawCacheMaxSize", ecoconf.rawCacheMaxSize, 50 * 1024 * 1024, 1),
    ssrCacheTtl: numberSetting("ssrCacheTtl", ecoconf.ssrCacheTtl, 0, 0),

    /**
     * @type {string}
     */
    logDir: process.env.ECO_LOG_DIR || ecoconf.logDir || "/var/log/server.log",
    accessLog: booleanSetting(process.env.ECO_ACCESS_LOG, ecoconf.accessLog !== false),

    /**
     * @type {boolean}
     */
    enableIsomorphic: !!ecoconf.enableIsomorphic,

    /**
     * @type {string | null}
     */
    chromiumPath: process.env.ECO_CHROMIUM_PATH || ecoconf.chromiumPath || DEFAULT_CHROMIUM_PATH,

    /**
     * @type {{[name: string]: string}}
     */
    header: ecoconf.header || {},

    /**
     * @type {import("./types.cts").ContentTypeMap}
     */
    contentType: {
        ...require("./contentType.json"),
        ...(ecoconf.contentType || {})
    },

    /**
     * @type {{[urlPrefix: string]: string}}
     */
    proxy: ecoconf.proxy || {},

    /**
     * @type {boolean}
     */
    use404File: existsSync(join(DIST_DIR, "404.html"))
} as Configuration;
