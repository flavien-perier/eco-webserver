"use strict";

const XML_SPACE_MATCHER = /\sxml:space\s*=\s*(["'])(preserve|default)\1/;

function findTagEnd(xml: string, start: number): number {
    let quote = "";

    for (let index = start; index < xml.length; index++) {
        const character = xml[index];
        if (quote) {
            if (character === quote) {
                quote = "";
            }
        } else if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === ">") {
            return index;
        }
    }

    return -1;
}

/**
 * Minifies XML while preserving CDATA sections byte for byte.
 */
module.exports = function minifyXmlText(inputXml: string): string {
    const preserveSpaceStack: boolean[] = [];
    let output = "";
    let position = 0;

    const appendText = (text: string) => {
        const preserveSpace = preserveSpaceStack[preserveSpaceStack.length - 1] === true;
        if (preserveSpace || !/^\s*$/.test(text)) {
            output += text;
        }
    };

    while (position < inputXml.length) {
        const tagStart = inputXml.indexOf("<", position);
        if (tagStart === -1) {
            appendText(inputXml.slice(position));
            break;
        }

        appendText(inputXml.slice(position, tagStart));

        if (inputXml.startsWith("<!--", tagStart)) {
            const commentEnd = inputXml.indexOf("-->", tagStart + 4);
            if (commentEnd === -1) {
                output += inputXml.slice(tagStart);
                break;
            }
            position = commentEnd + 3;
            continue;
        }

        if (inputXml.startsWith("<![CDATA[", tagStart)) {
            const cdataEnd = inputXml.indexOf("]]>", tagStart + 9);
            if (cdataEnd === -1) {
                output += inputXml.slice(tagStart);
                break;
            }
            output += inputXml.slice(tagStart, cdataEnd + 3);
            position = cdataEnd + 3;
            continue;
        }

        const tagEnd = findTagEnd(inputXml, tagStart + 1);
        if (tagEnd === -1) {
            output += inputXml.slice(tagStart);
            break;
        }

        const tag = inputXml.slice(tagStart, tagEnd + 1);
        output += tag;

        if (tag.startsWith("</")) {
            preserveSpaceStack.pop();
        } else if (!tag.startsWith("<!") && !tag.startsWith("<?")) {
            const parentPreserveSpace = preserveSpaceStack[preserveSpaceStack.length - 1] === true;
            const xmlSpace = tag.match(XML_SPACE_MATCHER);
            const preserveSpace = xmlSpace ? xmlSpace[2] === "preserve" : parentPreserveSpace;
            if (!/\/\s*>$/.test(tag)) {
                preserveSpaceStack.push(preserveSpace);
            }
        }

        position = tagEnd + 1;
    }

    return output;
};
