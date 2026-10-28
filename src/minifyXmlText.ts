"use strict";

const CDATA_MATCHER = /<!\[CDATA\[[\s\S]*?\]\]>/g;
const COMMENT_MATCHER = /<!--.*?-->/gs;
const SPACE_BETWEEN_TAGS_MATCHER = />\s+</gs;
const NEW_LINE_MATCHER = /[\n\r\t]+/g;
const MULTIPLE_SPACE_MATCHER = / {2,}/g;
const CDATA_PLACEHOLDER_MATCHER = /<eco-cdata-(\d+)\/>/g;

/**
 * Minifies XML while preserving CDATA sections byte for byte.
 */
module.exports = function minifyXmlText(inputXml: string): string {
    const cdataSections: string[] = [];
    const protectedXml = inputXml.replace(CDATA_MATCHER, match => {
        const index = cdataSections.push(match) - 1;
        return `<eco-cdata-${index}/>`;
    });

    return protectedXml
        .replace(COMMENT_MATCHER, "")
        .replace(SPACE_BETWEEN_TAGS_MATCHER, "><")
        .replace(NEW_LINE_MATCHER, " ")
        .replace(MULTIPLE_SPACE_MATCHER, " ")
        .trim()
        .replace(CDATA_PLACEHOLDER_MATCHER, (match, index) => cdataSections[Number(index)]);
};
