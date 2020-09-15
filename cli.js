#!/usr/bin/env node

const { existsSync, copyFileSync } = require("fs");
const { join } = require("path");

const server = require("./src/server");
const makeConfiguration = require("./src/makeConfiguration");

const CONF_DIR = join(process.cwd(), "ecoconf.js");

if (!existsSync(CONF_DIR)) {
    copyFileSync(join(__dirname, "src/ecoconf.js"), CONF_DIR);
}

const configuration = makeConfiguration(require(CONF_DIR));

server(configuration).listen(configuration.port, null, null, () => {
    console.log(`[${new Date().toISOString()}] Server start on the port ${configuration.port}`);
});
