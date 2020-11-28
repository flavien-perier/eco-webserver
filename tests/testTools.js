module.exports = {
    compareHtml: (actualHtml, expectedHtml) => expect(expectedHtml.replace(/\s+/gs, "")).toEqual(actualHtml.replace(/\s+/gs, ""))
}
