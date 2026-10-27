# AGENTS.md

## Commands

- `npm test` — full Jasmine suite (`jasmine --config=jasmine.json`, specs are `tests/**/*.spec.js`). CI (`.github/workflows/test.yml`) runs `npm install && npm test` on Node 16.
- Run one spec file: `npm test -- tests/server.spec.js` (positional paths resolve from the repo root, not from `spec_dir`).
- Run the server: `node cli.js` (bin `eco-webserver`). No build/transpile step — plain CommonJS.
- No lint, formatter, or typecheck tooling exists. Match existing style: 4-space indent, `require`/`module.exports`, JSDoc types on exports.

## Setup gotchas

- `canvas` is a native dependency. Prebuilds only cover old Node ABI (CI pins Node 16); on current Node versions `npm install` compiles it from source and needs cairo/pango/jpeg/giflib dev headers (see the Dockerfile builder stage for the package list).
- `sharp` (image → webp) is N-API: prebuilds work on Node 16 and current Node, but **no armv7 prebuild exists** — the arm/v7 Docker build compiles it from source, hence `vips-dev` in the builder stage and `vips` in the runtime image of the Dockerfile.
- `wawoff2` (font → woff2) is wasm-based, no native toolchain needed. It returns `Uint8Array`, wrapped in `Buffer` in `src/convertFont.js`.
- `package-lock.json` is deliberately gitignored.

## Architecture

- Entry: `cli.js` → `src/server.js`, which exports a factory returning an `http.Server` (not a server instance).
- `src/configuration.js` has require-time side effects: it loads `ecoconf.js` from `process.cwd()`, and if missing, copies the default template `src/ecoconf.js` there. Requiring any `src/*` module from another directory creates files in that directory.
- Env vars override config: `ECO_PORT`, `ECO_CACHE_CYCLE`, `ECO_DIST_DIR`, `ECO_CACHE_DIR`, `ECO_LOG_DIR`.
- The tracked root `ecoconf.js` uses Docker paths (`distDir: /dist`, `cacheDir: /cache`, `logDir: /var/log/server.log`) — running `node cli.js` from the repo root without env overrides serves `/dist` and fails writing `/var/log/server.log`.
- Request flow (`src/contentReader.js`): in-memory URL → `CacheValue` TTL cache (max TTL 10, decremented every `cacheCycle` seconds). `CacheValue` carries the final `contentType` (conversions change it: png/jpg/gif/tiff → `image/webp` via `sharp`, ttf/otf → `font/woff2` via `wawoff2`; on conversion failure the original bytes/type are served). Text formats are minified (terser for JS, svgo for SVG, jsdom pre-render for HTML when `enableIsomorphic`, regex minifiers for CSS/JSON/XML) and get `gzipData` + `brotliData` variants; binary formats are never recompressed. `src/server.js` negotiates `br` over `gzip` from `Accept-Encoding` and `src/buildHeader.js` takes the encoding string (`"br"`/`"gzip"`/`false`). Minified/converted results are persisted in a disk cache (`src/processingCache.js`) as `cacheDir/<sha256>.<format>` (`html`/`css`/`js`/`json`/`svg`/`xml`/`webp`/`woff2`); conversions are keyed by the sha256 of the *original* bytes, the ETag by the final bytes (pre-minification for text).
- `src/Logger.js` and `src/contentReader.js` start `setInterval` timers at require time — scripts requiring `src/*` do not exit on their own.

## Tests

- Specs stub config with `proxyquire` (`"@global": true` on `./configuration`) instead of env vars; keep that pattern for server-level specs. The stubbed `contentType` map must list every type a spec relies on — `contentReader` derives its text/conversion lists from it at require time.
- Fixtures live in `tests/testDist/{simple,404,isomorphic}` (`image.png`, `test.otf`, `sitemap.xml`, `test.svg`); the `sandbox` dist dir and `/tmp/eco-test-cache` are created/removed by the suites — do not commit them.
- `tests/testTools.compareHtml` compares whitespace-normalized HTML.
- `tests/server.spec.js` has a raw-http `requestRaw` helper (`http.request` + manual decompression) to assert `Content-Encoding`/bytes precisely — supertest/superagent transparently decompresses gzip and mangles other encodings.
- `jasmine.json` sets `stopSpecOnExpectationFailure: true`.

## Release

- Default branch: `master`.
- A GitHub **release** triggers `.github/workflows/npm-publish.yml` (`npm publish`). Bump the version in `package.json` and keep the Dockerfile label `org.opencontainers.image.version` in sync in the same commit.
- Pushing an `x.y.z` **tag** triggers `.github/workflows/docker-tag.yml` (multi-arch amd64/armv7/arm64 → `flavienperier/eco-webserver` on Docker Hub).