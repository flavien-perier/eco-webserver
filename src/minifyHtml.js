const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");

module.exports = function minifyHtml(inputHtml) {
    return inputHtml
        .replace(/^[\t ]*/gm, "")
        .replace(/[\n\r]/gm, "");
}