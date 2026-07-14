#!/usr/bin/env node
"use strict";

const { main } = require("../src/cli");

main(process.argv.slice(2)).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`TrucVPN error: ${message}`);
  process.exitCode = 1;
});
