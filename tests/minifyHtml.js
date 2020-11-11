const minifyHtml = require("../src/minifyHtml");

describe("minifyHtml", () => {
    it("Minify pure html", () => {
        const inputHtml = `<html lang="fr">
            <p id="id1" class="class1 class2">test< / p><br / >
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Minify html with css", () => {
        const inputHtml = `<html lang="fr">
            <p id="id1" class="class1 class2">test< / p><br / >
            <style>
                a:hover {
                    border-radius : 1px;
                    border: 1px solid #000;
                }
                
                .test {
                    background-color : blue;
                }
            </style>
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<style>a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}</style></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });
});
