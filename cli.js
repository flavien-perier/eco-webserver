#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const server = require("./src/server");

const CONF_DIR = path.join(process.cwd(), "ecoconf.js");

if (!fs.existsSync(CONF_DIR)) {
    fs.copyFileSync(path.join(__dirname, "src/ecoconf.js"), CONF_DIR);
}

const configuration = require(CONF_DIR);

server(configuration).listen(configuration.port, null, null, () => {
    console.log(`[${new Date().toISOString()}] Server start on the port ${configuration.port}`);
});
