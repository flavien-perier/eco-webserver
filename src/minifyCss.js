module.exports = function minifyCss(inputCss) {
    return inputCss
        .replace(/^[\t ]*/gm, "");
}