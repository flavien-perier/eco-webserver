const minifyHtml = require("../src/minifyHtml");

describe("minifyHtml", () => {
    it("Delete indentation", () => {
        const inputHtml = `<html lang="fr">
            <p id="id1" class="class1 class2">test< / p><br / >
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });
});
