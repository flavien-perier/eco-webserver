const minifyJson = require("../src/minifyJson");

describe("minifyJson", () => {
    it("Minify json file", () => {
        const inputJson = `{
            "number": 3.22,
            "string": "hello world {1, 2, 3}",
            "table": [ 
                1, 2, 3, 
                4, 5, 6
            ],
            "object": {
                "key": "value"
            }
        }`;

        const expectedJson = '{"number":3.22,"string":"hello world {1, 2, 3}","table":[1,2,3,4,5,6],"object":{"key":"value"}}';

        expect(minifyJson(inputJson)).toEqual(expectedJson);
    });

    it("Does not minify a badly formatted json file", () => {
        const inputJson = `{
            "key": "value"
        }{"other-key": "value"}`;

        expect(minifyJson(inputJson)).toEqual(inputJson);
    });
});
