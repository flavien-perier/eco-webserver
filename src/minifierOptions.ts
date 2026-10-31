"use strict";

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
};

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

module.exports = {
    HTML_MINIFY_OPTIONS,
    CSS_MINIFY_OPTIONS,
    JS_MINIFY_OPTIONS,
    SVGO_OPTIONS,
};
