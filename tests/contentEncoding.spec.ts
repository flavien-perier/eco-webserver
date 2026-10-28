const { encodingQuality, preferredEncoding } = require("../src/contentEncoding.ts");

describe("Accept-Encoding negotiation", () => {
    it("selects no encoding when the header is absent or empty", () => {
        expect(preferredEncoding("")).toBeFalse();
        expect(encodingQuality("", "gzip")).toEqual(0);
        expect(encodingQuality("", "br")).toEqual(0);
    });

    it("parses coding names and quality parameters case-insensitively", () => {
        expect(preferredEncoding(" GZip ; Q=0.8 , BR ; q=0.4 ")).toEqual("gzip");
    });

    it("honors the relative quality of gzip and Brotli", () => {
        expect(preferredEncoding("br;q=0.2, gzip;q=0.9")).toEqual("gzip");
        expect(preferredEncoding("br;q=0.9, gzip;q=0.2")).toEqual("br");
    });

    it("uses Brotli as the deterministic tie breaker", () => {
        expect(preferredEncoding("gzip;q=0.7, br;q=0.7")).toEqual("br");
    });

    it("applies a wildcard to both supported encodings", () => {
        expect(preferredEncoding("*;q=0.5")).toEqual("br");
        expect(encodingQuality("*;q=0.5", "gzip")).toEqual(0.5);
    });

    it("gives an explicit coding precedence over the wildcard", () => {
        expect(preferredEncoding("*;q=1, gzip;q=0")).toEqual("br");
        expect(preferredEncoding("*;q=0, gzip;q=0.5")).toEqual("gzip");
    });

    it("does not let a wildcard override explicit refusals", () => {
        expect(preferredEncoding("br;q=0, gzip;q=0, *;q=1")).toBeFalse();
    });

    it("does not enable an encoding with a non-numeric quality", () => {
        expect(preferredEncoding("gzip;q=invalid, br;q=0")).toBeFalse();
    });

    it("does not enable an encoding with an out-of-range quality", () => {
        expect(preferredEncoding("gzip;q=1.5, br;q=0")).toBeFalse();
    });

    it("does not enable wildcard encodings with a malformed quality", () => {
        expect(preferredEncoding("*;q=nope")).toBeFalse();
    });
});
