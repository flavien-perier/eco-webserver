const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { join, resolve } = require("path");

const configurationPath = resolve(__dirname, "../src/configuration.ts");
const defaultConfigurationPath = resolve(__dirname, "../src/ecoconf.js");
const temporaryRoot = "/tmp/opencode";

function cleanEnvironment() {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) {
        if (name.startsWith("ECO_")) delete environment[name];
    }
    return environment;
}

describe("configuration edge cases", () => {
    let temporaryDirectories;

    beforeEach(() => {
        temporaryDirectories = [];
    });

    afterEach(() => {
        for (const directory of temporaryDirectories) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    function loadConfiguration(environment = {}, configurationSource?: string) {
        const cwd = mkdtempSync(join(temporaryRoot, "eco-configuration-edge-"));
        temporaryDirectories.push(cwd);
        if (configurationSource !== undefined) {
            writeFileSync(join(cwd, "ecoconf.js"), configurationSource);
        }

        const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(configurationPath)}).default))`;
        const result = spawnSync(process.execPath, ["-e", script], {
            cwd,
            env: { ...cleanEnvironment(), ...environment },
            encoding: "utf8",
            timeout: 5000,
        });
        return { result, cwd };
    }

    function expectInvalid(environment, setting: string) {
        const { result } = loadConfiguration(environment);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`Invalid configuration ${setting}`);
    }

    function readConfiguration(result) {
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        return JSON.parse(result.stdout);
    }

    it("rejects NaN for a numeric environment setting", () => {
        expectInvalid({ ECO_PROXY_TIMEOUT: "NaN" }, "proxyTimeout");
    });

    it("rejects Infinity for a numeric environment setting", () => {
        expectInvalid({ ECO_PROXY_MAX_SIZE: "Infinity" }, "proxyMaxSize");
    });

    it("rejects a negative integer below its minimum", () => {
        expectInvalid({ ECO_CACHE_MAX_ENTRIES: "-1" }, "cacheMaxEntries");
    });

    it("rejects a decimal value for an integer setting", () => {
        expectInvalid({ ECO_DISK_CACHE_MAX_SIZE: "1.5" }, "diskCacheMaxSize");
    });

    it("accepts a positive decimal cache cycle", () => {
        const { result } = loadConfiguration({ ECO_CACHE_CYCLE: "0.125" });
        expect(readConfiguration(result).cacheCycle).toBe(0.125);
    });

    it("accepts zero for settings whose minimum is zero", () => {
        const { result } = loadConfiguration({
            ECO_CHROMIUM_MAX_QUEUE: "0",
            ECO_COMPRESSION_MAX_QUEUE: "0",
            ECO_CPU_WORKER_THRESHOLD: "0",
        });
        const configuration = readConfiguration(result);

        expect(configuration.chromiumMaxQueue).toBe(0);
        expect(configuration.compressionMaxQueue).toBe(0);
        expect(configuration.cpuWorkerThreshold).toBe(0);
    });

    it("accepts all documented accessLog boolean variants case-insensitively", () => {
        const expectations = [
            ["1", true],
            ["TRUE", true],
            ["Yes", true],
            ["0", false],
            ["FALSE", false],
            ["No", false],
        ];

        for (const [value, expected] of expectations) {
            const { result } = loadConfiguration({ ECO_ACCESS_LOG: value });
            expect(readConfiguration(result).accessLog).toBe(expected);
        }
    });

    it("rejects undocumented accessLog boolean variants", () => {
        for (const value of ["", "on", "off", "2", " true "]) {
            const { result } = loadConfiguration({ ECO_ACCESS_LOG: value });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(`Invalid boolean environment value: ${value}`);
        }
    });

    it("gives environment values priority over ecoconf values", () => {
        const source = `module.exports = {
            port: 1001,
            cacheCycle: 2,
            distDir: "config-dist",
            cacheDir: "config-cache",
            cacheMaxEntries: 11,
            cacheMaxSize: 12,
            diskCacheMaxSize: 13,
            proxyTimeout: 14,
            proxyMaxSize: 15,
            logDir: "config.log",
            accessLog: true,
            chromiumPath: "/config/chromium"
        };`;
        const { result } = loadConfiguration({
            ECO_PORT: "2002",
            ECO_CACHE_CYCLE: "3.5",
            ECO_DIST_DIR: "env-dist",
            ECO_CACHE_DIR: "env-cache",
            ECO_CACHE_MAX_ENTRIES: "21",
            ECO_CACHE_MAX_SIZE: "22",
            ECO_DISK_CACHE_MAX_SIZE: "23",
            ECO_PROXY_TIMEOUT: "24",
            ECO_PROXY_MAX_SIZE: "25",
            ECO_LOG_DIR: "env.log",
            ECO_ACCESS_LOG: "false",
            ECO_CHROMIUM_PATH: "/env/chromium",
        }, source);
        const configuration = readConfiguration(result);

        expect(configuration.port).toBe("2002");
        expect(configuration.cacheCycle).toBe(3.5);
        expect(configuration.distDir).toBe("env-dist");
        expect(configuration.cacheDir).toBe("env-cache");
        expect(configuration.cacheMaxEntries).toBe(21);
        expect(configuration.cacheMaxSize).toBe(22);
        expect(configuration.diskCacheMaxSize).toBe(23);
        expect(configuration.proxyTimeout).toBe(24);
        expect(configuration.proxyMaxSize).toBe(25);
        expect(configuration.logDir).toBe("env.log");
        expect(configuration.accessLog).toBeFalse();
        expect(configuration.chromiumPath).toBe("/env/chromium");
    });

    it("generates the default ecoconf only in the fresh working directory", () => {
        const { result, cwd } = loadConfiguration();
        const generatedPath = join(cwd, "ecoconf.js");
        const configuration = readConfiguration(result);

        expect(existsSync(generatedPath)).toBeTrue();
        expect(readFileSync(generatedPath, "utf8")).toBe(readFileSync(defaultConfigurationPath, "utf8"));
        expect(configuration.port).toBe(8080);
        expect(configuration.cacheCycle).toBe(1800);
        expect(configuration.distDir).toBe("dist");
        expect(configuration.cacheDir).toBe("cache");
        expect(configuration.logDir).toBe("application.log");
        expect(configuration.accessLog).toBeTrue();
    });
});
