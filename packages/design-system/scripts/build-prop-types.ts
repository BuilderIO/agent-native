import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { propTypesSource } from "../src/catalog/prop-types-source.js";

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/catalog/prop-types.generated.ts",
);
const contents = propTypesSource();

if (process.argv.includes("--check")) {
  let current: string | undefined;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = undefined;
  }
  if (current !== contents) {
    console.error(
      "src/catalog/prop-types.generated.ts is out of date. Run pnpm --filter @agent-native/design-system props.",
    );
    process.exit(1);
  }
} else {
  writeFileSync(target, contents);
  console.log("wrote src/catalog/prop-types.generated.ts");
}
