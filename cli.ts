#!/usr/bin/env node
"use strict";

const server = require("./src/server.ts");

const Logger = require("./src/Logger.ts");
const configuration = require("./src/configuration.ts").default;

const logger = new Logger();

server().listen(configuration.port, null, null, () => {
    logger.info(`Server start on the port ${configuration.port}`);
});