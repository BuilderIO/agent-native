import path from "node:path";

import { scanIdentityColumnsRegistered } from "../packages/core/src/guards/identity-columns-registered.js";

const root = path.resolve(import.meta.dirname, "..");

try {
  const result = scanIdentityColumnsRegistered({ root });
  if (result.findings.length) {
    console.error(
      `[guard:identity-columns-registered] ${result.findings.length} unregistered identity column(s):`,
    );
    for (const finding of result.findings) {
      console.error(`- ${finding.file}:${finding.line}: ${finding.message}`);
    }
    process.exit(1);
  }
  console.log(
    "[guard:identity-columns-registered] all runtime identity columns are registered",
  );
} catch (error) {
  console.error(
    `[guard:identity-columns-registered] could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
