#!/usr/bin/env node

const server = require("./src/server");
const configuration = require("./src/configuration").default;

server().listen(configuration.port, null, null, () => {
    console.log(`[${new Date().toISOString()}] Server start on the port ${configuration.port}`);
});
