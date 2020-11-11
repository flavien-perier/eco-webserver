const minifyHtml = require("../src/minifyHtml");

describe("minifyHtml", () => {
    it("Delete indentation", () => {
        const inputHtml = `<html>
            <p>test</p>
        <html>`;

        const expectedHtml = "<html><p>test</p><html>";

        expect(minifyHtml(inputHtml)).toEqual(expectedHtml);
    });
});
