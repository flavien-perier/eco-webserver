const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

function loadPool(configuration) {
    return proxyquire("../src/cpuPool.cts", {
        "./configuration.cts": { default: configuration, "@global": true }
    }).runCpuTask;
}

describe("cpuPool", () => {
    it("keeps inputs at or below the threshold local", async () => {
        const runCpuTask = loadPool({ cpuWorkerThreshold: 5, cpuPoolSize: 1, cpuMaxQueue: 0 });
        const localTask = jasmine.createSpy("localTask").and.returnValue("local");

        expect(await runCpuTask("json", "12345", localTask)).toBe("local");
        expect(localTask).toHaveBeenCalledTimes(1);
    });

    describe("real worker operations", () => {
        const runCpuTask = loadPool({ cpuWorkerThreshold: 0, cpuPoolSize: 2, cpuMaxQueue: 100 });
        const localTask = () => {
            throw new Error("The local fallback must not run");
        };

        it("minifies JavaScript with the original options", async () => {
            const output = await runCpuTask("js", "console.log('remove'); const value = 1 + 2;", localTask);
            expect(output).toBe("const value=3;");
        });

        it("minifies CSS, SVG, JSON and XML", async () => {
            const [css, svg, json, xml] = await Promise.all([
                runCpuTask("css", "a { color: #ff0000; }", localTask),
                runCpuTask("svg", '<svg xmlns="http://www.w3.org/2000/svg"><metadata>remove</metadata><path d="M 0 0 L 10 10"/></svg>', localTask),
                runCpuTask("json", '{ "value": 42 }', localTask),
                runCpuTask("xml", "<root> <!-- remove --> <value>42</value> </root>", localTask)
            ]);

            expect(css).toBe("a{color:red}");
            expect(svg).not.toContain("metadata");
            expect(svg).toContain("<path");
            expect(json).toBe('{"value":42}');
            expect(xml).toBe("<root><value>42</value></root>");
        });

        it("converts fonts and returns a Buffer", async () => {
            const input = fs.readFileSync("./tests/testDist/simple/test.otf");
            const output = await runCpuTask("font", input, localTask);

            expect(Buffer.isBuffer(output)).toBeTrue();
            expect(output.subarray(0, 4).toString()).toBe("wOF2");
        });

        it("returns worker processing errors to the wrapper", async () => {
            const error = await runCpuTask("json", "not json", localTask).then(() => null, err => err);
            expect(error).not.toBeNull();
            expect(error.name).toBe("SyntaxError");
        });
    });

    it("rejects immediately with status 503 when the pool and queue are full", async () => {
        const runCpuTask = loadPool({ cpuWorkerThreshold: 0, cpuPoolSize: 1, cpuMaxQueue: 0 });
        const localTask = () => {
            throw new Error("The local fallback must not run");
        };
        const input = '{ "value": 42 }';

        const first = runCpuTask("json", input, localTask);
        const rejected = runCpuTask("json", input, localTask);
        const error = await rejected.then(() => null, err => err);

        expect(error).not.toBeNull();
        expect(error.statusCode).toBe(503);
        expect(await first).toBe('{"value":42}');
    });

    it("runs queued tasks while rejecting beyond the configured queue", async () => {
        const runCpuTask = loadPool({ cpuWorkerThreshold: 0, cpuPoolSize: 1, cpuMaxQueue: 1 });
        const localTask = () => {
            throw new Error("The local fallback must not run");
        };
        const input = '{ "value": 42 }';

        const first = runCpuTask("json", input, localTask);
        const second = runCpuTask("json", input, localTask);
        const third = runCpuTask("json", input, localTask);
        const error = await third.then(() => null, err => err);

        expect(error.statusCode).toBe(503);
        expect(await first).toBe('{"value":42}');
        expect(await second).toBe('{"value":42}');
    });
});
