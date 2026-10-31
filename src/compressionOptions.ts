"use strict";

const { constants } = require("zlib");

/**
 * Static resources favour smaller cache artefacts over one-time encoding speed.
 */
const GZIP_OPTIONS = {
    level: 9,
};

const BROTLI_OPTIONS = {
    params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
    },
};

module.exports = {
    GZIP_OPTIONS,
    BROTLI_OPTIONS,
};
