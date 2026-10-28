# AGENTS.md

## Commands

- `npm test` — full Jasmine suite (`jasmine --config=jasmine.json`, specs are `tests/**/*.spec.ts`). CI (`.github/workflows/test.yml`) runs `npm install && npm test` on Node 24.
- Run one spec file: `npm test -- tests/server.spec.ts` (positional paths resolve from the repo root, not from `spec_dir`).
- Run the server: `node cli.cts` (bin `eco-webserver`). No build/transpile step — Node 24 strips TypeScript types from `.cts` CommonJS sources at load time (amaro).
- No lint, formatter, or typecheck tooling exists. Match existing style: 4-space indent, `require`/`module.exports`, JSDoc types on exports, native TS types on function signatures.
- `.cts` requires need explicit extensions (`require("./server.cts")`): extensionless resolution does not find `.cts` files, neither in sources nor in proxyquire stub keys (`"./configuration.cts"`) nor in `new Worker(<worker.cts path>)`.
- Type stripping is not a transform: `enum`, `namespace`, `import x = require(...)` and parameter properties throw at load time in `.cts` — use union string types and plain object constants instead.

## Setup gotchas

- `canvas` 3.x is N-API based: prebuilds cover current Node ABIs, `npm install` no longer compiles from source. The build deps remain only in the Docker builder stage for `sharp` armv7 (see below).
- `sharp` (image → webp) is N-API: prebuilds exist for glibc and musl on amd64/arm64, but **no armv7 prebuild** — the arm/v7 Docker build compiles it from source, hence `vips-dev` in the builder stage and `vips` in the runtime image of the Dockerfile.
- `wawoff2` (font → woff2) is wasm-based, no native toolchain needed. It returns `Uint8Array`, wrapped in `Buffer` in `src/convertFont.cts`.
- `puppeteer-core` downloads no browser: it launches the system chromium at `chromiumPath` (env `ECO_CHROMIUM_PATH`, autodetected among common `/usr/bin` paths).
- `jsdom` 30 removed the `ResourceLoader` export — `evaluateHtmlFile` in `src/contentReader.cts` loads and executes `<script>` sources manually in the jsdom VM context (no `resources` option).
- `package-lock.json` is deliberately gitignored.

## Architecture

- Entry: `cli.cts` → `src/server.cts`, which exports a factory returning an `http.Server` (not a server instance).
- `src/configuration.cts` has require-time side effects: it loads `ecoconf.js` from `process.cwd()`, and if missing, copies the default template `src/ecoconf.js` there. Requiring any `src/*` module from another directory creates files in that directory.
- Env vars override config: `ECO_PORT`, `ECO_CACHE_CYCLE`, `ECO_DIST_DIR`, `ECO_CACHE_DIR`, `ECO_CACHE_MAX_ENTRIES`, `ECO_CACHE_MAX_SIZE`, `ECO_DISK_CACHE_MAX_SIZE`, `ECO_LOG_DIR`, `ECO_ACCESS_LOG`, `ECO_CHROMIUM_PATH`, `ECO_CHROMIUM_CONCURRENCY`, `ECO_CHROMIUM_MAX_QUEUE`, `ECO_JSDOM_CONCURRENCY`, `ECO_PROXY_TIMEOUT`, `ECO_PROXY_MAX_SIZE`. Numeric configuration is validated as finite and range-checked at startup.
- `ECO_COMPRESSION_POOL_SIZE` (default 4) sizes the `CompressionPool` (`src/compressionPool.cts`, workers in `src/compressionWorker.cts`): text compression runs inside `worker_threads`; only the variant selected from `Accept-Encoding` is generated lazily (direct `readFile` callers without the header retain eager gzip+Brotli). Workers are lazy and replaced after failure; `compressionMaxQueue` bounds waiting tasks.
- Cold resource loads share `src/taskLimiter.cts` (`processingConcurrency`/`processingMaxQueue`). Large HTML/JS/CSS/JSON/SVG/XML minifications and font conversions use `src/cpuPool.cts` + `src/cpuWorker.cts` above `cpuWorkerThreshold`; small inputs stay local. jsdom SSR is isolated in `src/jsdomRenderer.cts` + `src/jsdomWorker.cts` with bounded workers/queue and a global deadline. Chromium uses an end-to-end deadline and a bounded raw sub-resource LRU in `src/rawResourceCache.cts`.
- The tracked root `ecoconf.js` uses Docker paths (`distDir: /dist`, `cacheDir: /cache`, `logDir: /var/log/server.log`) — running `node cli.cts` from the repo root without env overrides serves `/dist` and fails writing `/var/log/server.log`.
- Request flow (`src/contentReader.cts`): in-memory resource → `CacheValue` TTL + bounded LRU cache (max TTL 10, decremented every `cacheCycle` seconds; size/entry limits and mtime revalidation). Concurrent cold misses share one loading promise. `CacheValue` carries the final `contentType` (conversions change it: png/jpg/gif/tiff → `image/webp` via `sharp`, ttf/otf → `font/woff2` via `wawoff2`; on conversion failure the original bytes/type are served). Text formats are minified (html-minifier-terser for HTML, csso for CSS, terser for JS, svgo for SVG, regex minifiers for JSON/XML) and get lazy `gzipData`/`brotliData` variants compressed by the `CompressionPool` workers; binary formats are never recompressed. When `chromiumPath` resolves, `src/renderChromium.cts` pre-renders HTML with system chromium (bounded concurrency; request interception serves the document + cached raw `distDir` sub-resources; returns `null` → worker-isolated jsdom fallback). Optional persistent SSR entries use the `ssr` format when `ssrCacheTtl` is positive. `src/server.cts` negotiates `br`/`gzip` from `Accept-Encoding` qualities, caches file-existence decisions for `cacheValidationInterval`, and emits `Vary`/`Content-Length`. Minified/converted results are persisted asynchronously with atomic bounded writes in `src/processingCache.cts` as `cacheDir/v2-<sha256>.<format>` (`html`/`css`/`js`/`json`/`svg`/`xml`/`webp`/`woff2`/`ssr`), with oldest-first size eviction; conversions are keyed by the sha256 of the *original* bytes, the ETag by the final bytes (pre-minification for text).
- `src/Logger.cts` and `src/contentReader.cts` start `setInterval` timers at require time — scripts requiring `src/*` do not exit on their own.

## Tests

- Specs use `.ts` with CommonJS `require` (`tests/package.json`). Jasmine must keep the custom `tests/loader.cts` based on `createRequire`: its default dynamic-import loader breaks `proxyquire` under Node 24.
- Specs stub config with `proxyquire` (`"@global": true` on `./configuration.cts`) instead of env vars; keep that pattern for server-level specs. The stubbed `contentType` map must list every type a spec relies on — `contentReader` derives its text/conversion lists from it at require time.
- Fixtures live in `tests/testDist/{simple,404,isomorphic}` (`image.png`, `test.otf`, `sitemap.xml`, `test.svg`); the `sandbox` dist dir and `/tmp/eco-test-cache` are created/removed by the suites — do not commit them.
- `tests/testTools.compareHtml` compares whitespace-normalized HTML.
- `tests/server.spec.js` has a raw-http `requestRaw` helper (`http.request` + manual decompression) to assert `Content-Encoding`/bytes precisely — supertest/superagent transparently decompresses gzip and mangles other encodings.
- `jasmine.json` sets `stopSpecOnExpectationFailure: true`.

## Release

- Default branch: `master`.
- A GitHub **release** triggers `.github/workflows/npm-publish.yml` (`npm publish`). Bump the version in `package.json` and keep the Dockerfile label `org.opencontainers.image.version` in sync in the same commit.
- Pushing an `x.y.z` **tag** triggers `.github/workflows/docker-tag.yml` (multi-arch amd64/armv7/arm64 → `flavienperier/eco-webserver` on Docker Hub).