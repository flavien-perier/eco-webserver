"use strict";

const configuration = require("./configuration.ts").default;

const PROXY_PREFIXES = Object.keys(configuration.proxy || {}).sort((a, b) => b.length - a.length);

/**
 * Finds the longest configured proxy prefix of an encoded URL path.
 */
function findProxyPrefix(encodedPath: string): string | undefined {
    return PROXY_PREFIXES.find(prefix => encodedPath.startsWith(prefix));
}

/**
 * Builds an upstream URL while preserving the configured origin.
 */
function buildProxyUrl(requestUrl: string): URL {
    const request = new URL(requestUrl, "http://localhost");
    const requestBaseUrl = findProxyPrefix(request.pathname);
    if (requestBaseUrl === undefined) throw new Error(`No proxy configured for ${request.pathname}`);

    const proxyUrl = new URL(configuration.proxy[requestBaseUrl]);
    const basePath = proxyUrl.pathname.endsWith("/") ? proxyUrl.pathname.slice(0, -1) : proxyUrl.pathname;
    const suffix = request.pathname.slice(requestBaseUrl.length);

    proxyUrl.pathname = `${basePath}${suffix}` || "/";
    proxyUrl.search = request.search;
    proxyUrl.hash = "";
    return proxyUrl;
}

module.exports = {
    findProxyPrefix,
    buildProxyUrl,
};
