"use strict";

const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");
const { writeProcessingCache, readProcessingCache } = require("./processingCache");

const COMMENT_MATCHER = /<!--.*?-->/gs;
const BEGINNING_SAPCE_MATCHER = /^\s*/gm;
const OPENING_TAG_MATCHER = /<([\w\d-_]+)((?:\s+[\w\d-_]+(?:\s*=\s*(?:["'].*?["']|[^ >]*))?)*)\s*?(\/)?\s*?>/sg;
const KEY_VALUE_MATCHER = /([\w\d-_]+)(?: *= *(["'].*?["']|\S*))?/sg;
const CLOSING_TAG_MATCHER = /<\s*\/\s*([\w\d-_]+)>/sg;
const BLANK_SPACE_BETWEEN_TAGS_MATCHER = />\s+</sg;
const STYLE_TAG_MATCHER = /(<style.*?>)(.*?)<\/style>/sg;
const SCRIPT_TAG_MATCHER = /(<script.*?>)(.*?)<\/script>/sg;

const DELETED_PARAMETERS = [
    "script:type",
    "script:charset",
    "style:type",
    "style:charset"
];

/**
 * Reforms a HTML page.
 *
 * @param {string} inputHtml
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyHtml(inputHtml, hash) {
    const cacheHtml = readProcessingCache(hash, "html");

    if (cacheHtml) {
        return cacheHtml.toString();
    }

    let outputHtml = inputHtml
        // Deletes comments
        .replace(COMMENT_MATCHER, "")
        // Removes spaces at the beginning of the line.
        .replace(BEGINNING_SAPCE_MATCHER, "")
        // Reformatting html opening tags.
        .replace(OPENING_TAG_MATCHER, (_, baliseName, parameters, end) => {
            // Reformatting tags parameters.
            const parametersList = [];
            parameters.replace(KEY_VALUE_MATCHER, (_, key, value) => {
                if (value == null) parametersList.push(key);
                else if (value == "\"\"" || value == "''" || value == "") {}
                else if (DELETED_PARAMETERS.indexOf(`${baliseName}:${key}`) != -1) {}
                else if (value.search(" ") == -1 && value.search("=") == -1) parametersList.push(`${key}=${value.replace(/["`]/sg, "")}`);
                else parametersList.push(`${key}=${value}`);
            });
            return `<${baliseName}${parametersList.length > 0 ? " " : ""}${parametersList.join(" ")}${end || ""}>`;
        })
        // Reformatting html closing tags.
        .replace(CLOSING_TAG_MATCHER, (_, baliseName) => `</${baliseName}>`)
        // Removes blanks between tags.
        .replace(BLANK_SPACE_BETWEEN_TAGS_MATCHER, "><")
        // Reformatting css.
        .replace(STYLE_TAG_MATCHER, (_, balise, code) => `${balise}${minifyCss(code)}</style>`);

    // Reformatting js.
    await new Promise((resolve, reject) => {
        const scriptTags = [...outputHtml.match(SCRIPT_TAG_MATCHER) || []].filter(element => element != "");
        let countTasks = 0;
        if (scriptTags.length == 0) {
            resolve();
            return;
        }

        scriptTags.map(scriptTag => new RegExp(SCRIPT_TAG_MATCHER).exec(scriptTag)).forEach(async ([fullMatch, balise, code]) => {
            outputHtml = outputHtml.replace(fullMatch, `${balise}${await minifyJs(code || "")}</script>`);
            if (++countTasks >= scriptTags.length) {
                resolve();
            }
        });
    });

    writeProcessingCache(outputHtml, hash, "html");

    return outputHtml;
}
