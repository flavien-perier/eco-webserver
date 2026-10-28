const { spawnSync } = require("child_process");
const { resolve } = require("path");

const configurationPath = resolve(__dirname, "../src/configuration.cts");

function loadConfiguration(environment) {
    return spawnSync(process.execPath, ["-e", `require(${JSON.stringify(configurationPath)})`], {
        cwd: resolve(__dirname, ".."),
        env: { ...process.env, ...environment },
        encoding: "utf8",
    });
}

describe("configuration validation", () => {
    it("rejects a non-finite cache cycle", () => {
        const result = loadConfiguration({ ECO_CACHE_CYCLE: "abc" });
        expect(result.status).not.toEqual(0);
        expect(result.stderr).toContain("Invalid configuration cacheCycle");
    });

    it("rejects non-finite resource limits", () => {
        const result = loadConfiguration({ ECO_CACHE_MAX_SIZE: "Infinity" });
        expect(result.status).not.toEqual(0);
        expect(result.stderr).toContain("Invalid configuration cacheMaxSize");
    });

    it("accepts a zero-sized Chromium queue", () => {
        const result = spawnSync(process.execPath, ["-e", `process.stdout.write(String(require(${JSON.stringify(configurationPath)}).default.chromiumMaxQueue))`], {
            cwd: resolve(__dirname, ".."),
            env: { ...process.env, ECO_CHROMIUM_MAX_QUEUE: "0" },
            encoding: "utf8",
        });
        expect(result.status).toEqual(0);
        expect(result.stdout).toEqual("0");
    });
});
