import process from "node:process";

import { scanReleaseSchemaCoverage } from "../packages/core/src/guards/release-schema-complete.js";

const result = scanReleaseSchemaCoverage({ root: process.cwd() });

if (result.findings.length > 0) {
  console.error(
    [
      "Stores defining schema that the release step never creates:",
      "",
      ...result.findings.map(
        (finding) => `  - ${finding.file}:${finding.line}: ${finding.message}`,
      ),
      "",
      "Declare the module's schema with defineStore() from packages/core/src/db/store-registry.ts,",
      "then run `pnpm gen:store-registry`. Hosted request runtimes never create tables, so schema",
      "outside a registered store has no path to creation on a hosted deploy.",
      "For a reviewed exception, add // guard:allow-unreleased-schema - <reason> to the file.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Store registry is fresh and covers every module that defines tables (${result.findings.length} findings).`,
);
