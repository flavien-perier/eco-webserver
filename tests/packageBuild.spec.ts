const fs = require("fs");
const http = require("http");
const net = require("net");
const { tmpdir } = require("os");
const { join, resolve } = require("path");
const { spawn, spawnSync } = require("child_process");
const { gunzipSync } = require("zlib");

const ROOT = resolve(__dirname, "..");

/**
 * Reserves a free local port.
 */
function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolvePort(port));
        });
        server.on("error", reject);
    });
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: any; body: Buffer }> {
    return new Promise((resolveResponse, reject) => {
        const request = http.get({ host: "127.0.0.1", port, path, headers }, response => {
            const chunks: Buffer[] = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolveResponse({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
        });
        request.setTimeout(5000, () => request.destroy(new Error("Request timed out")));
        request.on("error", reject);
    });
}

async function waitForServer(port: number, child: any, output: () => string): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Packaged server exited early:\n${output()}`);
        try {
            await get(port, "/");
            return;
        } catch(err) {
            await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
        }
    }
    throw new Error(`Packaged server did not start:\n${output()}`);
}

describe("published package", () => {
    // Installed packages live under node_modules, where Node refuses to strip
    // TypeScript types: the build must ship plain JavaScript there.
    const installDir = join(ROOT, "node_modules", ".cache", `eco-webserver-package-${process.pid}`);
    let workDir: string;
    let child: any;

    beforeAll(() => {
        const build = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/build.ts", installDir], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(build.status).withContext(build.stderr).toBe(0);
    });

    beforeEach(() => {
        workDir = fs.mkdtempSync(join(tmpdir(), "eco-package-run-"));
    });

    afterEach(() => {
        if (child && child.exitCode === null) child.kill();
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    afterAll(() => {
        fs.rmSync(installDir, { recursive: true, force: true });
    });

    it("ships no TypeScript source", () => {
        const files = fs.readdirSync(installDir, { recursive: true }) as string[];

        expect(files).toContain("cli.js");
        expect(files.filter(file => file.endsWith(".ts"))).toEqual([]);
        expect(fs.readFileSync(join(installDir, "cli.js"), "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
    });

    it("serves, minifies in workers and compresses when installed under node_modules", async () => {
        const port = await freePort();
        let output = "";
        child = spawn(process.execPath, [join(installDir, "cli.js")], {
            cwd: workDir,
            env: {
                ...process.env,
                ECO_PORT: String(port),
                ECO_DIST_DIR: join(ROOT, "tests", "testDist", "simple"),
                ECO_CACHE_DIR: join(workDir, "cache"),
                ECO_LOG_DIR: join(workDir, "server.log"),
                ECO_CPU_WORKER_THRESHOLD: "0",
                ECO_CHROMIUM_PATH: "/nonexistent",
            },
        });
        child.stdout.on("data", chunk => output += chunk);
        child.stderr.on("data", chunk => output += chunk);

        await waitForServer(port, child, () => output);
        const html = await get(port, "/index.html", { "Accept-Encoding": "gzip" });
        const image = await get(port, "/image.png");

        expect(html.statusCode).toBe(200);
        expect(html.headers["content-encoding"]).toBe("gzip");
        expect(gunzipSync(html.body).toString()).toContain("<html");
        expect(image.headers["content-type"]).toBe("image/webp");
        expect(output).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
    });
});
