"use strict";

const { writeProcessingCache, readProcessingCache } = require("./processingCache.ts");
const { runCpuTask } = require("./cpuPool.ts");
const minifyXmlText = require("./minifyXmlText.ts");

/**
 * Reforms a XML file.
 */
module.exports = async function minifyXml(inputXml: string, hash: string): Promise<string> {
    const cacheXml = await readProcessingCache(hash, "xml");

    if (cacheXml) {
        return cacheXml.toString();
    }

    const outputXml = await runCpuTask("xml", inputXml, () => minifyXmlText(inputXml));

    await writeProcessingCache(outputXml, hash, "xml");

    return outputXml;
};
