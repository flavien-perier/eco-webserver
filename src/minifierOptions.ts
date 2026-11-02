"use strict";

const csso = require("csso");
const { minify: minifyJavaScript } = require("terser");

const CSS_MINIFY_OPTIONS = {
    restructure: true,
};

const JS_MINIFY_OPTIONS = {
    mangle: true,
    compress: {
        drop_console: true,
        passes: 2,
    },
};

const SVGO_OPTIONS = {
    multipass: true,
};

/**
 * Minifies CSS embedded in HTML. Style attributes and media queries are not
 * stylesheets: they are wrapped into one before csso and unwrapped afterwards,
 * as html-minifier-terser does for its built-in minifier.
 */
async function minifyEmbeddedCss(text: string, type?: "inline" | "media"): Promise<string> {
    try {
        if (type === "inline") {
            const match = csso.minify(`*{${text}}`, CSS_MINIFY_OPTIONS).css.match(/^\*\{([\s\S]*)\}$/);
            return match ? match[1] : text;
        }
        if (type === "media") {
            const match = csso.minify(`@media ${text}{a{top:0}}`, CSS_MINIFY_OPTIONS).css.match(/^@media ([\s\S]*?)\s*\{[\s\S]*\}$/);
            return match ? match[1] : text;
        }
        return csso.minify(text, CSS_MINIFY_OPTIONS).css;
    } catch(err) {
        return text;
    }
}

/**
 * Minifies JavaScript embedded in HTML. Event handler attributes allow bare
 * returns; a snippet terser cannot parse is kept as is instead of failing the
 * whole document.
 */
async function minifyEmbeddedJs(text: string, inline?: boolean): Promise<string> {
    const start = text.match(/^\s*<!--.*/);
    const code = start ? text.slice(start[0].length).replace(/\n\s*-->\s*$/, "") : text;

    try {
        const result = await minifyJavaScript(code, {
            ...JS_MINIFY_OPTIONS,
            parse: { bare_returns: Boolean(inline) },
        });
        return typeof result.code === "string" ? result.code : text;
    } catch(err) {
        return text;
    }
}

/**
 * Shared by local transformations and CPU workers so input size never changes
 * the minification result.
 */
const HTML_MINIFY_OPTIONS = {
    caseSensitive: true,
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    keepClosingSlash: true,
    removeAttributeQuotes: true,
    removeComments: true,
    removeEmptyAttributes: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    minifyCSS: minifyEmbeddedCss,
    minifyJS: minifyEmbeddedJs,
};

module.exports = {
    HTML_MINIFY_OPTIONS,
    CSS_MINIFY_OPTIONS,
    JS_MINIFY_OPTIONS,
    SVGO_OPTIONS,
};
