const minify = require("html-minifier").minify;

const minifyConfiguration = {
    collapseWhitespace: true,
    preserveLineBreaks: false
};

module.exports = {
    compareHtml: (actualHtml, expectedHtml) => {
        const html1 = minify(actualHtml, minifyConfiguration);
        const html2 = minify(expectedHtml, minifyConfiguration);

        expect(html1).toEqual(html2);
    }
}
