# AGENTS.md

## Commands

- `npm test` — full Jasmine suite (`jasmine --config=jasmine.json`, specs are `tests/**/*.spec.js`). CI (`.github/workflows/test.yml`) runs `npm install && npm test` on Node 24.
- Run one spec file: `npm test -- tests/server.spec.js` (positional paths resolve from the repo root, not from `spec_dir`).
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
- Env vars override config: `ECO_PORT`, `ECO_CACHE_CYCLE`, `ECO_DIST_DIR`, `ECO_CACHE_DIR`, `ECO_LOG_DIR`, `ECO_CHROMIUM_PATH`.
- `ECO_COMPRESSION_POOL_SIZE` (default 4) sizes the `CompressionPool` (`src/compressionPool.cts`, workers in `src/compressionWorker.cts`): text compression (`gzip` + `brotli`) runs inside `worker_threads`, the main event loop stays free during first renderings; workers are lazy (created with the first task) and a failing worker is transparently replaced.
- The tracked root `ecoconf.js` uses Docker paths (`distDir: /dist`, `cacheDir: /cache`, `logDir: /var/log/server.log`) — running `node cli.cts` from the repo root without env overrides serves `/dist` and fails writing `/var/log/server.log`.
- Request flow (`src/contentReader.cts`): in-memory URL → `CacheValue` TTL cache (max TTL 10, decremented every `cacheCycle` seconds). `CacheValue` carries the final `contentType` (conversions change it: png/jpg/gif/tiff → `image/webp` via `sharp`, ttf/otf → `font/woff2` via `wawoff2`; on conversion failure the original bytes/type are served). Text formats are minified (terser for JS, svgo for SVG, jsdom pre-render for HTML when `enableIsomorphic`, regex minifiers for CSS/JSON/XML) and get `gzipData` + `brotliData` variants compressed by the `CompressionPool` workers; binary formats are never recompressed. When `chromiumPath` resolves, `src/renderChromium.cts` pre-renders HTML with system chromium (request interception serves the document + `distDir` sub-resources; returns `null` → jsdom fallback if chromium is missing or fails to launch). `src/server.cts` negotiates `br` over `gzip` from `Accept-Encoding` and `src/buildHeader.cts` takes the encoding string (`"br"`/`"gzip"`/`false`). Minified/converted results are persisted in a disk cache (`src/processingCache.cts`) as `cacheDir/<sha256>.<format>` (`html`/`css`/`js`/`json`/`svg`/`xml`/`webp`/`woff2`); conversions are keyed by the sha256 of the *original* bytes, the ETag by the final bytes (pre-minification for text).
- `src/Logger.cts` and `src/contentReader.cts` start `setInterval` timers at require time — scripts requiring `src/*` do not exit on their own.

## Tests

- Specs stub config with `proxyquire` (`"@global": true` on `./configuration.cts`) instead of env vars; keep that pattern for server-level specs. The stubbed `contentType` map must list every type a spec relies on — `contentReader` derives its text/conversion lists from it at require time.
- Fixtures live in `tests/testDist/{simple,404,isomorphic}` (`image.png`, `test.otf`, `sitemap.xml`, `test.svg`); the `sandbox` dist dir and `/tmp/eco-test-cache` are created/removed by the suites — do not commit them.
- `tests/testTools.compareHtml` compares whitespace-normalized HTML.
- `tests/server.spec.js` has a raw-http `requestRaw` helper (`http.request` + manual decompression) to assert `Content-Encoding`/bytes precisely — supertest/superagent transparently decompresses gzip and mangles other encodings.
- `jasmine.json` sets `stopSpecOnExpectationFailure: true`.

## Release

- Default branch: `master`.
- A GitHub **release** triggers `.github/workflows/npm-publish.yml` (`npm publish`). Bump the version in `package.json` and keep the Dockerfile label `org.opencontainers.image.version` in sync in the same commit.
- Pushing an `x.y.z` **tag** triggers `.github/workflows/docker-tag.yml` (multi-arch amd64/armv7/arm64 → `flavienperier/eco-webserver` on Docker Hub).