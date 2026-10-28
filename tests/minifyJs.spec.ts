const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration.ts": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const processingCache = proxyquire("../src/processingCache.ts", mockConfiguration);
const minifyJs = proxyquire("../src/minifyJs.ts", {
    ...mockConfiguration,
    "./processingCache.ts": processingCache
});

describe("minifyJs", () => {
    afterEach(async () => {
        await processingCache.flushProcessingCache();
        fs.rmSync(TEST_CACHE, { recursive: true, force: true });
    });

    it("Minify pure js", async () => {
        const inputJs = `
            function test() {
                if ( yes === 3 ) {
                    return {
                        a : 4,
                        "b": "test",
                        c: [4, 
                            5,
                            "(a == 3)"
                        ]
                    };
                }
            }
        `;

        const fileHash = "jsHash1";

        const expectedJs = "function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}";

        expect(await minifyJs(inputJs, fileHash)).toEqual(expectedJs);
    });

    it("Minify js with class", async () => {
        const inputJs = `
            class A {
                constructor(a, b) {
                    this.a = a;
                    this.b = b;
                }

                method() {
                    this.a += this.b;
                }

                get a() {
                    return this.a;
                }
            }

            const a = new A();
        `;

        const fileHash = "jsHash2";

        const expectedJs = "class A{constructor(a,b){this.a=a,this.b=b}method(){this.a+=this.b}get a(){return this.a}}const a=new A;";

        expect(await minifyJs(inputJs, fileHash)).toEqual(expectedJs);
    });

    it("Does not minify a badly formatted js file", async () => {
        const inputJs = `
            class A {
                constructor(a, b) {
                    this.a = a;
                    this.b = b;
                }

                method() {
                    this.a += this.b;
                }

                get a() {
                    return this.a;
                }

            const a = new A();
        `;

        const fileHash = "jsHash3";

        expect(await minifyJs(inputJs, fileHash)).toEqual(inputJs);
    });

    it("Minifies large files in a worker", async () => {
        const inputJs = `const value = "${"x".repeat(70 * 1024)}"; console.log(value);`;
        const outputJs = await minifyJs(inputJs, "jsLargeHash");

        expect(outputJs).not.toContain("console.log");
        expect(outputJs).toContain("const value=");
        expect(outputJs.length).toBeGreaterThan(70 * 1024);
    });

    it("Test cache", async () => {
        const inputJs = `
            function test() {
                if ( yes === 3 ) {
                    return {
                        a : 4,
                        "b": "test",
                        c: [4, 
                            5,
                            "(a == 3)"
                        ]
                    };
                }
            }
        `;

        const fileHash = "jsHash4";

        const expectedJs = "function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}";

        // Processing
        expect(await minifyJs(inputJs, fileHash)).toEqual(expectedJs);

        // Cache
        expect(await minifyJs(inputJs, fileHash)).toEqual(expectedJs);

        // Modify cache file and read it
        fs.writeFileSync(`${TEST_CACHE}/v2-${fileHash}.js`, "test");
        expect(await minifyJs(inputJs, fileHash)).toEqual("test");
    });
});
