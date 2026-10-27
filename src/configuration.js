"use strict";

const { existsSync, copyFileSync } = require("fs");
const { join } = require("path");

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

exports.default = {
    /**
     * @type {number}
     */
    port: process.env.ECO_PORT || ecoconf.port || 8080,

    /**
     * @type {number}
     */
    cacheCycle: process.env.ECO_CACHE_CYCLE || ecoconf.cacheCycle || 1800,

    /**
     * @type {string}
     */
    distDir: DIST_DIR,

    /**
     * @type {string}
     */
    cacheDir: process.env.ECO_CACHE_DIR || ecoconf.cacheDir || "/tmp/eco-webserver",

    /**
     * @type {string}
     */
    logDir: process.env.ECO_LOG_DIR || ecoconf.logDir || "/var/log/server.log",

    /**
     * @type {boolean}
     */
    enableIsomorphic: !!ecoconf.enableIsomorphic,

    /**
     * @type {string | null}
     */
    chromiumPath: process.env.ECO_CHROMIUM_PATH || ecoconf.chromiumPath || DEFAULT_CHROMIUM_PATH,

    /**
     * @type {{[string]: string}}
     */
    header: ecoconf.header || {},

    /**
     * @type {{[string]: string}}
     */
    contentType: {
        ...require("./contentType.json"),
        ...(ecoconf.contentType || {})
    },

    /**
     * @type {{[string]: string}}
     */
    proxy: ecoconf.proxy || {},

    /**
     * @type {boolean}
     */
    use404File: existsSync(join(DIST_DIR, "404.html"))
};
