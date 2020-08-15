#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { JSDOM } = require("jsdom");

const CONF_DIR = path.join(process.cwd(), "ecoconf.json");

if (!fs.existsSync(CONF_DIR)) {
    fs.copyFileSync(path.join(__dirname, "ecoconf.json"), CONF_DIR)
}

const configuration = require(CONF_DIR);
const contentType = {
    ...require("./contentType.json"),
    ...configuration.contentType
};

const PORT = configuration.port || 8080;
const CACHE_CYCLE = (configuration.cacheCycle || 1800) * 1000;
const BASE_PATH = path.join(process.cwd(), configuration.distDir || "dist");
const USE_404_FILE = fs.existsSync(path.join(BASE_PATH, "404.html"));
const USE_500_FILE = fs.existsSync(path.join(BASE_PATH, "500.html"));
const ENABLE_ISOMORPHIC = configuration.enableIsomorphic ? true : false;

const TXT_CONETENT_TYPE = [contentType.html, contentType.css, contentType.js, contentType.json];

const cache = new Map();

setInterval(() => {
    cache.forEach((value, key, cache) => {
        if (value.ttl <= 0) {
            cache.delete(key);
        } else if (value.ttl > 10) {
            value.ttl = 10;
        } else {
            value.ttl--;
        }
    });
}, CACHE_CYCLE);

class CacheValue {
    async build(filePath, requestUrl, fileContentType) {
        if (fileContentType == contentType.html && ENABLE_ISOMORPHIC) {
            this.data = await evaluateHtmlFile(fs.readFileSync(path.join(BASE_PATH, filePath), "utf8"), requestUrl);
            this.dataType = "txt";
        } else if (TXT_CONETENT_TYPE.indexOf(fileContentType) != -1) {
            this.data = fs.readFileSync(path.join(BASE_PATH, filePath), "utf8");
            this.dataType = "txt";
        } else {
            this.data = fs.readFileSync(path.join(BASE_PATH, filePath));
            this.dataType = "bin";
        }

        this.gzipData = zlib.gzipSync(this.data);
    }
}

function evaluateHtmlFile(fileContent, requestUrl) {
    return new Promise((resolve, reject) => {
        const dom = new JSDOM(fileContent, {
            url: `http://127.0.0.1:${PORT}${requestUrl}`,
            referrer: `http://127.0.0.1:${PORT}${requestUrl}`,
            contentType: "text/html",
            userAgent: "internal-eco-webserver",
            strictSSL: false,
            includeNodeLocations: true,
            runScripts: "dangerously"
        });
    
        [...dom.window.document.getElementsByTagName("script").valueOf()]
            .forEach(async script => {
                if (script.attributes && script.attributes.src && script.attributes.src.value) {
                    const contentFile = await readFile(script.attributes.src.value, script.attributes.src.value, contentType.js, false);
                    dom.window.eval(contentFile);
                }
            });
    
        setTimeout(() => {
            const computedHtml = dom.window.document.documentElement.outerHTML;
            dom.window.stop();
            resolve(computedHtml);
        }, 1500);
    });
}

function getContentType(filePath) {
    const parsing = /\.([a-zA-Z0-9]+)$/.exec(filePath);

    if (!parsing) {
        return null;
    }

    const extension = parsing[1];

    if (extension && contentType[extension]) {
        return contentType[extension];
    } else {
        return contentType.text;
    }
}

function buildHeader(contentType, useGzip) {
    const header = {
        "Content-Type": contentType,
        ...configuration.header
    };

    if (useGzip) {
        header["Content-Encoding"] = "gzip";
    }

    return header;
}

async function readFile(filePath, requestUrl, fileContentType, useGzip) {
    let cacheValue;
    if (cache.has(requestUrl)) {
        cacheValue = cache.get(requestUrl);
        cacheValue.ttl++;
    } else {
        cacheValue = new CacheValue();
        await cacheValue.build(filePath, requestUrl, fileContentType);
        cache.set(requestUrl, cacheValue);
    }

    return useGzip ? cacheValue.gzipData : cacheValue.data;
}

http.createServer(async (req, res) => {
    console.info(`[${new Date().toISOString()}] [${req.headers["x-real-ip"] || req.connection.remoteAddress}] [${req.headers["user-agent"]}] - ${req.method}: ${req.url}`);

    const fileUrl = path.join(BASE_PATH, req.url);
    const useGzip = (req.headers["accept-encoding"] || "").indexOf("gzip") != -1;

    try {
        if (fs.existsSync(fileUrl) && fs.lstatSync(fileUrl).isFile()) {
            const contentType = getContentType(req.url);
            res.writeHead(200, buildHeader(contentType, useGzip));
            res.write(await readFile(req.url, req.url, contentType, useGzip));
        } else if (USE_404_FILE) {
            res.writeHead(404, "Not found", buildHeader(contentType.html, useGzip));
            res.write(await readFile("404.html", req.url, contentType.html, useGzip));
        } else {
            res.writeHead(200, buildHeader(contentType.html, useGzip));
            res.write(await readFile("index.html", req.url, contentType.html, useGzip));
        }
    } catch(err) {
        console.error(`[${new Date().toISOString()}] Internal server error: ${err.text}`)
        res.writeHead(500, "Internal server error", buildHeader(contentType.html, useGzip));
        if (USE_500_FILE) {
            res.write(await readFile("500.html", req.url, contentType.html, useGzip));
        }
    }

    res.end();
}).listen(PORT, null, null, () => {
    console.log(`[${new Date().toISOString()}] Server start on the port ${PORT}`)
});
