![license](https://badgen.net/github/license/flavien-perier/eco-webserver)
[![docker pulls](https://badgen.net/docker/pulls/flavienperier/eco-webserver)](https://hub.docker.com/r/flavienperier/eco-webserver)
[![npm version](https://badgen.net/npm/v/eco-webserver)](https://www.npmjs.com/package/eco-webserver)
[![ci status](https://badgen.net/github/checks/flavien-perier/eco-webserver)](https://github.com/flavien-perier/eco-webserver)

# eco-webserver

The objective of eco-webserver is to propose a nodejs server able to reduce the network footprint of a static site or a single page application (SPA).

To do so, the server uses different strategies depending on the types of files it hosts.

## Features

- [X] Cache files
- [X] Reverse proxy
- [X] Isomorphic application
- [X] Isomorphic rendering with chromium via [puppeteer-core](https://www.npmjs.com/package/puppeteer-core) (jsdom fallback)
- [X] Multithreaded `gzip` and `brotli` compression with [worker_threads](https://nodejs.org/api/worker_threads.html)

The server sources are written in TypeScript and executed directly by Node.js 24 (type stripping) — no compilation step is required.
- [X] GZIP and brotli implementation
- [X] Include Etag
- [X] Include html minifiers
- [X] Include css minifiers
- [X] Include json minifiers
- [X] Include js minifiers with [terser](https://www.npmjs.com/package/terser)
- [X] Include svg minifiers with [svgo](https://www.npmjs.com/package/svgo)
- [X] Include xml minifiers
- [X] Optimize images and convert them to webp with [sharp](https://www.npmjs.com/package/sharp)
- [X] Optimize fonts and convert them to woff2 with [wawoff2](https://www.npmjs.com/package/wawoff2)

## Usage

### Installation

```sh
npm install -g eco-webserver
```

### Command line

```sh
cd project
eco-webserver
```

By default, the `eco-webserver` command does not take any parameters. If no configuration file is present in the current directory, the application will automatically create one.

### Configuration

Create `ecoconf.js` at the base path of the project :

```js
module.exports = {
    port: 8080,
    cacheCycle: 1800,
    distDir: "dist",
    cacheDir: "cache",
    cacheMaxEntries: 1000,
    cacheMaxSize: 100 * 1024 * 1024,
    cacheValidationInterval: 60 * 1000,
    diskCacheMaxSize: 512 * 1024 * 1024,
    diskCacheCleanupInterval: 60 * 60 * 1000,
    diskWriteConcurrency: 2,
    diskWriteMaxQueue: 100,
    processingConcurrency: 4,
    processingMaxQueue: 100,
    compressionPoolSize: 4,
    compressionMaxQueue: 100,
    cpuPoolSize: 2,
    cpuMaxQueue: 100,
    cpuWorkerThreshold: 64 * 1024,
    rawCacheMaxEntries: 500,
    rawCacheMaxSize: 50 * 1024 * 1024,
    ssrCacheTtl: 0,
    logDir: "/tmp/eco-webserver.log",
    accessLog: true,
    enableIsomorphic: true,
    chromiumPath: "/usr/bin/chromium-browser",
    chromiumConcurrency: 2,
    chromiumMaxQueue: 100,
    chromiumRenderTimeout: 30000,
    chromiumWaitUntil: "networkidle0",
    jsdomConcurrency: 2,
    jsdomMaxQueue: 100,
    jsdomRenderTimeout: 10000,
    proxyTimeout: 10000,
    proxyMaxSize: 50 * 1024 * 1024,
    scriptTimeout: 1000,
    scriptLoadConcurrency: 8,
    header: {
        "Server": "eco-webserver",
        "Cache-Control": "max-age=86400",
        "X-XSS-Protection": "1;mode=block",
        "X-Frame-Options": "DENY",
    },
    contentType: {
        "mp4": "video/mpeg",
    },
    proxy: {
        "/articles": "https://articles.flavien.io/"
    },
}
```

- **port**: The default port of the application.
- **cacheCycle**: Duration in seconds between two cache check cycles.
- **distDir**: Location of website files to be exhibited.
- **cacheDir**: Location of the working cache.
- **cacheMaxEntries**: Maximum number of resources kept in the in-memory LRU cache (default 1000).
- **cacheMaxSize**: Maximum total size in bytes of the in-memory resources and their compressed variants (default 100 MiB).
- **cacheValidationInterval**: Interval in milliseconds between modification-time checks for cached local files (default 60000).
- **diskCacheMaxSize**: Maximum size in bytes of processed artefacts before the oldest files are evicted (default 512 MiB).
- **diskCacheCleanupInterval**: Minimum interval in milliseconds between disk cache cleanups (default one hour).
- **diskWriteConcurrency**: Maximum number of asynchronous processing-cache writes (default 2).
- **diskWriteMaxQueue**: Maximum number of processing-cache writes waiting for disk (default 100). Overflowing best-effort writes are discarded.
- **processingConcurrency**: Maximum number of distinct cold resources loaded or transformed simultaneously (default 4).
- **processingMaxQueue**: Maximum number of cold resource loads waiting for a processing slot (default 100).
- **compressionPoolSize**: Number of workers generating gzip and Brotli variants (default 4).
- **compressionMaxQueue**: Maximum number of compression tasks waiting for a worker (default 100).
- **cpuPoolSize**: Number of lazy workers used for large minifications and font conversions (default 2).
- **cpuMaxQueue**: Maximum number of CPU tasks waiting for a worker (default 100).
- **cpuWorkerThreshold**: Minimum input size in bytes before minification or font conversion is delegated to a CPU worker (default 64 KiB).
- **rawCacheMaxEntries**: Maximum number of raw Chromium sub-resources kept in memory (default 500).
- **rawCacheMaxSize**: Maximum total size of raw Chromium sub-resources in bytes (default 50 MiB).
- **ssrCacheTtl**: Optional lifetime in milliseconds of persistent SSR renderings (default 0, disabled). Enable only for pages whose rendered content is safe to share and cache.
- **logDir**: Location of log file.
- **accessLog**: Enables per-request console/file logging (default true).
- **enableIsomorphic**: Calculates a rendering of the JavaScript scripts before sending the page to the client.
- **chromiumPath**: Path of the chromium binary used to calculate the isomorphic rendering. If the path is not defined or if the binary is missing, the rendering automatically falls back on jsdom.
- **chromiumConcurrency**: Maximum number of simultaneous Chromium pages (default 2).
- **chromiumMaxQueue**: Maximum number of renderings waiting for a Chromium slot (default 100).
- **chromiumRenderTimeout**: End-to-end Chromium rendering deadline in milliseconds, including queueing and cleanup (default 30000).
- **chromiumWaitUntil**: Puppeteer navigation wait condition (default `networkidle0`).
- **jsdomConcurrency**: Maximum number of isolated jsdom workers (default 2).
- **jsdomMaxQueue**: Maximum number of jsdom renderings waiting for a worker (default 100).
- **jsdomRenderTimeout**: End-to-end jsdom rendering deadline in milliseconds (default 10000).
- **proxyTimeout**: Timeout in milliseconds for upstream requests and external scripts (default 10000).
- **proxyMaxSize**: Maximum upstream response size in bytes (default 50 MiB).
- **scriptTimeout**: Maximum execution time in milliseconds for each jsdom script (default 1000).
- **scriptLoadConcurrency**: Maximum number of scripts downloaded concurrently by one jsdom worker (default 8).
- **header**: Html headers of the different queries.
- **contentType**: Allows you to add Content-Types if those supported by default by the application are not enough.
- **proxy**: Allows you to associate a remote resource with a local URL in order to cache it.

For PaaS or Docker platform users, it is possible to inject configuration through environment variables :

- `ECO_PORT`: The default port of the application.
- `ECO_CACHE_CYCLE`: Duration in seconds between two cache check cycles.
- `ECO_DIST_DIR`: Location of website files to be exhibited.
- `ECO_CACHE_DIR`: Location of the working cache.
- `ECO_CACHE_MAX_ENTRIES`: Maximum number of resources in memory (default 1000).
- `ECO_CACHE_MAX_SIZE`: Maximum in-memory cache size in bytes (default 100 MiB).
- `ECO_DISK_CACHE_MAX_SIZE`: Maximum processing cache size in bytes (default 512 MiB).
- `ECO_LOG_DIR`: Location of log file.
- `ECO_CHROMIUM_PATH`: Path of the chromium binary used for the isomorphic rendering.
- `ECO_CHROMIUM_CONCURRENCY`: Maximum number of simultaneous Chromium pages (default 2).
- `ECO_CHROMIUM_MAX_QUEUE`: Maximum number of renderings waiting for a Chromium slot (default 100).
- `ECO_JSDOM_CONCURRENCY`: Maximum number of isolated jsdom workers (default 2).
- `ECO_PROXY_TIMEOUT`: Upstream request timeout in milliseconds (default 10000).
- `ECO_PROXY_MAX_SIZE`: Maximum upstream response size in bytes (default 50 MiB).
- `ECO_COMPRESSION_POOL_SIZE`: Number of worker threads used to compress the text resources with `gzip` and `brotli` (default 4).
- `ECO_COMPRESSION_MAX_QUEUE`: Maximum number of queued compression tasks (default 100).
- `ECO_CPU_POOL_SIZE`: Number of workers used for large CPU-heavy transformations (default 2).
- `ECO_CPU_WORKER_THRESHOLD`: Minimum input size in bytes delegated to CPU workers (default 64 KiB).
- `ECO_ACCESS_LOG`: Enables access logs when set to `1`, `true` or `yes`; disables them with `0`, `false` or `no`.

### With Docker

The image includes a chromium build used for the isomorphic rendering (`ECO_CHROMIUM_PATH` is already configured).

#### Ports

- 8080: HTTP

#### Volumes

- /dist
- /cache

#### Docker-compose example

```yaml
dns:
  image: flavienperier/eco-webserver
  container_name: eco-webserver
  restart: always
  volumes:
    - ./dist:/dist
    - ./cache:/cache
  ports:
    - 8080:8080
  environment:
    ECO_CACHE_CYCLE: 1800
```

### File organisation

If a client queries an unknown URL, the server will automatically redirect the request to the `index.html` file. If the server has a `404.html` file, the server will redirect its requests to this file.

## How the cache works ?

Each time a user requests a resource, it is cached. If the resource is requested again, its TTL will be incremented by 1 to a maximum of 10.

At each cache cycle (every 30 minutes in the default configuration), all TTL values are decremented by 1 and those falling to 0 are deleted from the cache. The cache is also an LRU bounded by `cacheMaxEntries` and `cacheMaxSize`; local files are periodically revalidated using their modification time.

Minification operations on resources are kept in a persistent, versioned disk cache. The objective here is not to redo a minification operation that would have already been done in the past. Consequently, the cache associates the sha256 sum of a resource with its result after processing. Writes are atomic, asynchronous and bounded; the oldest artefacts are removed when `diskCacheMaxSize` is exceeded.

Text responses are compressed lazily with gzip level 9 and Brotli quality 11: only the variant selected from `Accept-Encoding` is generated, and concurrent requests share its computation. Compressed variants are also persisted by final content hash, so the higher compression cost is normally paid only once. Cold processing, CPU workers, compression and jsdom rendering all have bounded concurrency and queues. File-existence decisions are cached for `cacheValidationInterval`, so creating, deleting or replacing a file can take up to that interval to affect routing.

When `ssrCacheTtl` is positive, rendered HTML is also persisted using the source hash and request path. This can avoid Chromium or jsdom work after a restart, but must only be enabled for non-personalized pages with content that may be reused for the configured lifetime.
