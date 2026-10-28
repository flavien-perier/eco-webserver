"use strict";

const { createRequire } = require("module");
const { join } = require("path");
const requireFromProject = createRequire(join(process.cwd(), "jasmine.cjs"));

/**
 * Loads CommonJS TypeScript specs through a native require so proxyquire keeps
 * its parent module and Node's extension handlers.
 *
 * @param {string} modulePath
 * @returns {Promise<any>}
 */
module.exports = async function load(modulePath: string): Promise<any> {
    return requireFromProject(modulePath);
};
