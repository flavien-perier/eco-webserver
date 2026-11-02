#!/usr/bin/env node
"use strict";

// Committed entry point: npm validates `bin` before `prepack` builds lib/,
// so the bin target itself must exist in the repository.
require("../lib/cli.js");
