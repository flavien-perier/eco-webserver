const minifyJs = require("../src/minifyJs");

describe("minifyJs", () => {
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
});
