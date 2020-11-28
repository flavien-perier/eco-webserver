const minifyHtml = require("../src/minifyHtml");

describe("minifyHtml", () => {
    it("Minify pure html", () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Minify html with css", () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
            <style>
                a:hover {
                    border-radius : 1px;
                    border: 1px solid #000;
                }

                /* Test comment */
                .test {
                    background-color : blue;
                }
            </style>
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<style>a:hover{border-radius:1px;border:1px solid #000}.test{background-color:blue}</style></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });

    it("Minify html with js", () => {
        const inputHtml = `<html lang="fr">
            <!-- Test
                comment -->
            <p id="id1" class="class1 class2">test< / p><br class = ""/ >
            <script>
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
            </script>
        < / html>`;

        const expectedHtml = "<html lang=fr><p id=id1 class=\"class1 class2\">test</p><br/>"
            + "<script>function test(){if(yes===3){return{a:4,b:\"test\",c:[4,5,\"(a == 3)\"]}}}</script></html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });
});
