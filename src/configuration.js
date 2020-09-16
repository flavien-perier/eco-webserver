"use strict";

const { existsSync, copyFileSync } = require("fs");
const { join } = require("path");

const CONF_DIR = join(process.cwd(), "ecoconf.js");

if (!existsSync(CONF_DIR)) {
    copyFileSync(join(__dirname, "ecoconf.js"), CONF_DIR);
}

const ecoconf = require(CONF_DIR);

const DIST_DIR = join(process.cwd(), process.env.ECO_DIST_DIR || ecoconf.distDir || "dist");

exports.default = {
    port: process.env.ECO_PORT || ecoconf.port || 8080,
    cacheCycle: process.env.ECO_CACHE_CYCLE || ecoconf.cacheCycle || 1800,
    distDir: DIST_DIR,
    logDir: process.env.ECO_LOG_DIR || ecoconf.logDir || "/var/log/server.log",
    enableIsomorphic: ecoconf.enableIsomorphic ? true : false,
    header: ecoconf.header || {},
    contentType: {
        ...require("./contentType.json"),
        ...(ecoconf.contentType || {})
    },
    proxy: ecoconf.proxy || {},

    use404File: existsSync(join(DIST_DIR, "404.html")),
    use500File: existsSync(join(DIST_DIR, "500.html"))
};
