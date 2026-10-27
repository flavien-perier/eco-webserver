"use strict";

module.exports = {
    port: 8080,
    cacheCycle: 1800,
    distDir: "/dist",
    logDir: "/var/log/server.log",
    cacheDir: "/cache",
    enableIsomorphic: true,
    chromiumPath: "/usr/bin/chromium-browser",
    header: {
        "Server": "eco-webserver",
    },
    contentType: {},
    proxy: {},
}
