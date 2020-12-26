const fs = require("fs");
const proxyquire = require("proxyquire").noPreserveCache();

const TEST_CACHE = "./tests/test-cache";

const mockConfiguration = {
    "./configuration": { default: { cacheDir: TEST_CACHE }, "@global": true }
};

const minifyJs = proxyquire("../src/minifyJs", mockConfiguration);

describe("minifyJs", () => {
    afterEach(() => {
        fs.rmdirSync(TEST_CACHE, { recursive: true });
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
            }`;

        const expectedJs = "function test(){if(3===yes)return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}";

        expect(await minifyJs(inputJs)).toEqual(expectedJs);
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

        const expectedJs = "class A{constructor(a,b){this.a=a,this.b=b}method(){this.a+=this.b}get a(){return this.a}}const a=new A;";

        expect(await minifyJs(inputJs)).toEqual(expectedJs);
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

        expect(await minifyJs(inputJs)).toEqual(inputJs);
    });
});
