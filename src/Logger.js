"use strict";

const { appendFileSync } = require("fs");

const configuration = require("./configuration").default;

let logBuffer = [];

const logWriter = setInterval(() => {
    logBuffer.forEach(message => appendFileSync(configuration.logDir, message + "\n"));
    logBuffer = [];
}, 60 * 1000);

function print(logLevel, logMessage) {
    const message = `${logLevel}: [${new Date().toISOString()}] ${logMessage}`;
    console.log(message);
    logBuffer.push(message);
}

class Logger {
    constructor() {}

    /**
     * @param {string} message
     */
    info(message) {
        print("info", message);
    }

    error(message, error) {
        print("error", message);
        if (error) {
            console.error(error);
        }
    }

    http(ip, userAgent, method, url) {
        print("http", `[${ip}] [${userAgent}] - ${method}: ${url}`);
    }
}

module.exports = Logger;
