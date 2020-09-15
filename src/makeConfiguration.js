"use strict";

module.exports = function(ecoconf) {
    return {
        port: process.env.ECO_PORT || ecoconf.port || 8080,
        cacheCycle: process.env.ECO_CACHE_CYCLE || ecoconf.cacheCycle || 1800,
        distDir: process.env.ECO_DIST_DIR || ecoconf.distDir || "dist",
        logDir: process.env.ECO_LOG_DIR || ecoconf.logDir || "/var/log/server.log",
        enableIsomorphic: ecoconf.enableIsomorphic ? true : false,
        header: ecoconf.header || {},
        contentType: ecoconf.contentType || {},
        proxy: ecoconf.proxy || {}
    };
}
