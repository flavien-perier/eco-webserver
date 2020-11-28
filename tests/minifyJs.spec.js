const minifyJs = require("../src/minifyJs");

describe("minifyJs", () => {
    it("Minify pure js", () => {
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

        const expectedJs = "function test(){if(yes===3){return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}}";

        expect(minifyJs(inputJs)).toEqual(expectedJs);
    });
});
