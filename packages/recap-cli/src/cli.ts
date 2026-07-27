#!/usr/bin/env node

import { runRecap } from "./recap.js";

const argv = process.argv.slice(2);
if (argv[0] === "recap") argv.shift();

runRecap(argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
