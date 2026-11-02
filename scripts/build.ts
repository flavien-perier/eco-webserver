"use strict";

/**
 * Emits the published JavaScript package. Node refuses to strip TypeScript
 * types from files under node_modules, so an installed package must not ship
 * `.ts` sources: every module is type-stripped and `.ts` specifiers (requires
 * and worker file names) are rewritten to `.js`.
 *
 * Usage: node scripts/build.ts [outDir]   (default: lib)
 */

const { stripTypeScriptTypes } = require("module");
const { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("fs");
const { join, resolve } = require("path");

const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, process.argv[2] || "lib");
const TS_SPECIFIER = /(["'])((?:\.{1,2}\/)?[\w./-]+)\.ts\1/g;

/**
 * Converts one TypeScript module into a JavaScript module.
 */
function emitModule(source: string, destination: string): void {
    const code = stripTypeScriptTypes(readFileSync(source, "utf8"), { mode: "strip" });
    writeFileSync(destination, code.replace(TS_SPECIFIER, "$1$2.js$1"));
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "src"), { recursive: true });

emitModule(join(ROOT, "cli.ts"), join(OUT_DIR, "cli.js"));

for (const file of readdirSync(join(ROOT, "src"))) {
    const source = join(ROOT, "src", file);
    if (file.endsWith(".ts")) {
        emitModule(source, join(OUT_DIR, "src", file.replace(/\.ts$/, ".js")));
    } else {
        copyFileSync(source, join(OUT_DIR, "src", file));
    }
}
