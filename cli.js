#!/usr/bin/env node

const server = require("./src/server");

const Logger = require("./src/Logger");
const configuration = require("./src/configuration").default;

const logger = new Logger();

server().listen(configuration.port, null, null, () => {
    logger.info(`Server start on the port ${configuration.port}`);
});
