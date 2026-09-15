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
      "Add the store's zero-argument ensure function to packages/core/src/server/release-schema.ts.",
      "Production serverless cannot create tables on the request path, so a store missing from that list",
      "has no path to creation on a hosted deploy — the first symptom is a missing-relation error in prod.",
      "For a reviewed exception, add // guard:allow-unreleased-schema - <reason> to the file.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Release schema list covers every store that defines tables (${result.findings.length} findings).`,
);
