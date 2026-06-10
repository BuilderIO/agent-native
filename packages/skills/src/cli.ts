#!/usr/bin/env node

import { runSkillsCli } from "./index.js";

runSkillsCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
