"use strict";

const { appendFile } = require("fs/promises");

const configuration = require("./configuration.ts").default;

const MAX_BUFFERED_LOGS = 10000;

/**
 * Contains logs that have not yet been written to the log file.
 */
let logBuffer: string[] = [];
let droppedLogs = 0;
let flushing = false;

/**
 * Empties the log buffer with one asynchronous append.
 */
async function flushLogs(): Promise<void> {
    if (flushing || (logBuffer.length === 0 && droppedLogs === 0)) return;
    flushing = true;

    const messages = logBuffer;
    logBuffer = [];
    if (droppedLogs > 0) {
        messages.unshift(`error: [${new Date().toISOString()}] ${droppedLogs} log messages dropped because the buffer was full`);
        droppedLogs = 0;
    }

    try {
        await appendFile(configuration.logDir, messages.join("\n") + "\n");
    } catch(err) {
        console.error("Unable to write application logs", err);
    } finally {
        flushing = false;
    }
}

setInterval(flushLogs, 60 * 1000);

/**
 * Displays the content of a log in the console and adds this same log to the log buffer.
 */
function print(logLevel: string, logMessage: string): void {
    const message = `${logLevel}: [${new Date().toISOString()}] ${logMessage}`;
    console.log(message);

    if (logBuffer.length < MAX_BUFFERED_LOGS) logBuffer.push(message);
    else droppedLogs++;
}

/**
 * Logger of the Eco-webserver application.
 */
module.exports = class Logger {
    constructor() {}

    /**
     * Format the log to display a piece of information.
     */
    info(message: string): void {
        print("info", message);
    }

    /**
     * Format the log to display an error message.
     */
    error(message: string, error?: any): void {
        print("error", message);
        if (error) {
            console.error(error);
        }
    }

    /**
     * Format the log of a request sent to the server.
     */
    http(ip: string, userAgent: string, method: string, url: string): void {
        print("http", `[${ip}] [${userAgent}] - ${method}: ${url}`);
    }
};
