import path from "node:path";

import { scanActionChangeResource } from "../packages/core/src/guards/action-change-resource.js";

const root = path.resolve(import.meta.dirname, "..");

try {
  const result = scanActionChangeResource({ root });
  if (result.findings.length) {
    console.error(
      `[guard:action-change-resource] ${result.findings.length} mutating action(s) core cannot name a change resource for:`,
    );
    for (const finding of result.findings) {
      console.error(`- ${finding.file}:${finding.line}: ${finding.message}`);
    }
    process.exit(1);
  }
  console.log(
    "[guard:action-change-resource] every mutating action names its change resource",
  );
} catch (error) {
  console.error(
    `[guard:action-change-resource] could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}
