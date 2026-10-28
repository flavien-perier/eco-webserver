"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");

const COMMENT_MATCHER = /<!--.*?-->/gs;
const SPACE_BETWEEN_TAGS_MATCHER = />\s+</gs;
const NEW_LINE_MATCHER = /[\n\r\t]+/g;
const MULTIPLE_SPACE_MATCHER = / {2,}/g;

/**
 * Reforms a XML file.
 *
 * @param {string} inputXml
 * @param {string} hash
 * @returns {Promise<string>}
 */
module.exports = async function minifyXml(inputXml: string, hash: string): Promise<string> {
    const cacheXml = await readProcessingCache(hash, "xml");

    if (cacheXml) {
        return cacheXml.toString();
    }

    const outputXml = await runCpuTask("xml", inputXml, () => inputXml
        // Deletes comments
        .replace(COMMENT_MATCHER, "")
        // Removes blanks between tags.
        .replace(SPACE_BETWEEN_TAGS_MATCHER, "><")
        // Replaces new lines and tabs by a single space.
        .replace(NEW_LINE_MATCHER, " ")
        // Reduces the number of spaces.
        .replace(MULTIPLE_SPACE_MATCHER, " ")
        .trim());

    await writeProcessingCache(outputXml, hash, "xml");

    return outputXml;
}