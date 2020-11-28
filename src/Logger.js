"use strict";

const { appendFileSync } = require("fs");

const configuration = require("./configuration").default;

/**
 * Contains logs that have not yet been written to the log file.
 * 
 * @type {Array<string>}
 */
let logBuffer = [];


/**
 * Empty the log buffer at regular time interval in the log file.
 */
setInterval(() => {
    logBuffer.forEach(message => appendFileSync(configuration.logDir, message + "\n"));
    logBuffer = [];
}, 60 * 1000);

/**
 * Displays the content of a log in the console and adds this same log to the log buffer.
 *
 * @param {string} logLevel
 * @param {string} logMessage
 */
function print(logLevel, logMessage) {
    const message = `${logLevel}: [${new Date().toISOString()}] ${logMessage}`;
    console.log(message);
    logBuffer.push(message);
}

/**
 * Logger of the Eco-webserver application.
 */
module.exports = class Logger {
    constructor() {}

    /**
     * Format a log to display a piece of information.
     *
     * @param {string} message
     */
    info(message) {
        print("info", message);
    }

    /**
     * Format a log for an error message.
     *
     * @param {string} message
     * @param {any} error
     */
    error(message, error) {
        print("error", message);
        if (error) {
            console.error(error);
        }
    }

    /**
     * Format the log of a request sent to the server.
     *
     * @param {string} ip
     * @param {string} userAgent
     * @param {string} method
     * @param {string} url
     */
    http(ip, userAgent, method, url) {
        print("http", `[${ip}] [${userAgent}] - ${method}: ${url}`);
    }
}
