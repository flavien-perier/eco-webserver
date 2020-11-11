const minifyCss = require("../src/minifyCss");

describe("minifyCss", () => {
    it("Minify pure css", () => {
        const inputCss = `a:hover {
            border-radius : 1px;
            border: 1px solid #000;
        }
        
        .test {
            background-color : blue;
        }`;

        const expectedCss = "a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}";

        expect(minifyCss(inputCss)).toEqual(expectedCss);
    });
});
