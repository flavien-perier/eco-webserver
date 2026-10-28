"use strict";

/**
 * Returns the quality associated with an encoding in Accept-Encoding.
 */
function encodingQuality(header: string, encoding: string): number {
    let quality: number | null = null;
    let wildcardQuality: number | null = null;

    for (const part of header.split(",")) {
        const [name, ...parameters] = part.trim().toLowerCase().split(";");
        let currentQuality = 1;

        for (const parameter of parameters) {
            const match = /^\s*q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*$/.exec(parameter);
            if (match) currentQuality = Number(match[1]);
        }

        if (name === encoding) quality = currentQuality;
        else if (name === "*") wildcardQuality = currentQuality;
    }

    return quality ?? wildcardQuality ?? 0;
}

/**
 * Chooses an encoding from client preferences without requiring the variant to
 * have been generated already.
 */
function preferredEncoding(header: string): "br" | "gzip" | false {
    const brotliQuality = encodingQuality(header, "br");
    const gzipQuality = encodingQuality(header, "gzip");

    if (brotliQuality > 0 && brotliQuality >= gzipQuality) return "br";
    if (gzipQuality > 0) return "gzip";
    return false;
}

module.exports = {
    encodingQuality,
    preferredEncoding,
};
