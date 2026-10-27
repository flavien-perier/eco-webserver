"use strict";

const { appendFileSync } = require("fs");

const configuration = require("./configuration.cts").default;

/**
 * Contains logs that have not yet been written to the log file.
 *
 * @type {string[]}
 */
let logBuffer: string[] = [];

/**
 * Empty the log buffer at regular time interval in the log file.
 */
setInterval((): void => {
    logBuffer.forEach(message => appendFileSync(configuration.logDir, message + "\n"));
    logBuffer = [];
}, 60 * 1000);

/**
 * Displays the content of a log in the console and adds this same log to the log buffer.
 *
 * @param {string} logLevel
 * @param {string} logMessage
 */
function print(logLevel: string, logMessage: string): void {
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
     * @returns {void}
     */
    info(message: string): void {
        print("info", message);
    }

    /**
     * Format a log for an error message.
     *
     * @param {string} message
     * @param {any} error
     * @returns {void}
     */
    error(message: string, error?: any): void {
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
     * @returns {void}
     */
    http(ip: string, userAgent: string, method: string, url: string): void {
        print("http", `[${ip}] [${userAgent}] - ${method}: ${url}`);
    }
}