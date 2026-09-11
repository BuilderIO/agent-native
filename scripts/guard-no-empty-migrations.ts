import process from "node:process";

import { scanEmptyMigrations } from "../packages/core/src/guards/no-empty-migrations.js";

const result = scanEmptyMigrations({ root: process.cwd() });

if (result.findings.length > 0) {
  console.error(
    [
      "Empty migration plugins found:",
      "",
      ...result.findings.map(
        (finding) => `  - ${finding.file}:${finding.line}: ${finding.message}`,
      ),
      "",
      "Remove the empty runMigrations([]) call. The core helper treats an empty list as a no-op, so a plugin slot does not need a database check.",
      "For a reviewed compatibility exception, add // guard:allow-empty-migrations - <reason> next to the call.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("No empty migration plugins found.");
