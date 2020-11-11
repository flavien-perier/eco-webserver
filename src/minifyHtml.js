const minifyCss = require("./minifyCss");
const minifyJs = require("./minifyJs");

module.exports = function minifyHtml(inputHtml) {
    return inputHtml
        // Reformatting html opening tags.
        .replace(/<([\w\d-_]+)((?:\s+[\w\d-_]+\s*=\s*(?:["'].*?["']|[^ >]*))*)\s*?(\/)?\s*?>/sg, (_, baliseName, parameters, end) => {
            // Reformatting tags parameters.
            const parametersList = [];
            parameters.replace(/([\w\d-_]+) *= *(["'].*?["']|\S*)/sg, (_, key, value) => {
                if (value.search(" ") == -1) parametersList.push(`${key}=${value.replace(/["`]/sg, "")}`);
                else parametersList.push(`${key}=${value}`);
            });
            return `<${baliseName}${parametersList.length > 0 ? " " : ""}${parametersList.join(" ")}${end || ""}>`;
        })
        // Reformatting html closing tags.
        .replace(/<\s*\/\s*([\w\d-_]+)>/sg, (_, baliseName) => `</${baliseName}>`)
        // Removes blanks between tags.
        .replace(/>\s+</sg, "><");
}
