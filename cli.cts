#!/usr/bin/env node
"use strict";

const server = require("./src/server.cts");

const Logger = require("./src/Logger.cts");
const configuration = require("./src/configuration.cts").default;

const logger = new Logger();

server().listen(configuration.port, null, null, () => {
    logger.info(`Server start on the port ${configuration.port}`);
});