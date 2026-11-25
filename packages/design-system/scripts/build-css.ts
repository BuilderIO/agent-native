import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatedStylesheets } from "../src/generated-css.js";
import { COMPONENTS_FILE } from "../src/tokens/component-inputs.js";
import { TOKEN_FILES } from "../src/tokens/source.js";
import { renderSwitchDefaults } from "./switch-defaults.js";

const cssDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../css",
);
const check = process.argv.includes("--check");
const stale: string[] = [];

for (const [file, contents] of Object.entries({
  ...generatedStylesheets(),
  "parts/switch.css": renderSwitchDefaults(
    readFileSync(path.join(cssDir, "parts/switch.css"), "utf8"),
    TOKEN_FILES[COMPONENTS_FILE],
  ),
})) {
  const target = path.join(cssDir, file);
  if (check) {
    let current: string | undefined;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== contents) stale.push(file);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  console.log(`wrote css/${file}`);
}

if (stale.length > 0) {
  console.error(
    `Generated CSS is out of date: ${stale.join(", ")}. Run pnpm --filter @agent-native/design-system css.`,
  );
  process.exit(1);
}
