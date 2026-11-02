module.exports = {
    compareHtml: (actualHtml: string, expectedHtml: string) => expect(expectedHtml.replace(/\s+/gs, "")).toEqual(actualHtml.replace(/\s+/gs, ""))
}
