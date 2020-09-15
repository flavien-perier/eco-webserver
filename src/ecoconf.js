"use strict";

module.exports = {
    port: 8080,
    cacheCycle: 1800,
    distDir: "dist",
    logDir: "/var/log/server.log",
    enableIsomorphic: true,
    header: {
        "Server": "eco-webserver",
        "Cache-Control": "max-age=86400",
        "X-XSS-Protection": "1;mode=block",
        "X-Frame-Options": "DENY"
    },
    contentType: {
        "mp4": "video/mpeg"
    },
    proxy: {
        "/logo.png": "https://avatars3.githubusercontent.com/u/19231288?s=460&u=5c37f3bb39a8ba2a6e925f120e71b748b254e3d9&v=4"
    }
}
