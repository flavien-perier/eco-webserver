module.exports = function minifyJs(inputJs) {
    return inputJs
        .replace(/^[\t ]*/gm, "");
}
