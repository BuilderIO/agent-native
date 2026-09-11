#!/usr/bin/env node

import { runSkillsCli } from "./index.js";

runSkillsCli(process.argv.slice(2))
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
