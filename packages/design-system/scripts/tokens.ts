/**
 * Token files to and from Figma.
 *
 *   pnpm --filter @agent-native/design-system tokens:export <dir>
 *   pnpm --filter @agent-native/design-system tokens:import <dir>
 *
 * Export writes `<dir>/<collection>/<mode>.tokens.json`: import each folder
 * into Figma as a collection, one file per mode. Import reads the same layout
 * back from a Figma export, refuses anything code cannot read, and rewrites
 * the source files under `src/tokens/files/`.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  exportForFigma,
  formatTokenFile,
  importFromFigma,
  TokenImportError,
} from "../src/tokens/round-trip.js";
import { TOKEN_FILES } from "../src/tokens/source.js";

const FILES_DIR = fileURLToPath(
  new URL("../src/tokens/files/", import.meta.url),
);
const USAGE = "Usage: tokens <export|import> <dir>";

function readExport(dir: string): Map<string, unknown> {
  const exported = new Map<string, unknown>();
  for (const folder of readdirSync(dir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const entry of readdirSync(path.join(dir, folder.name))) {
      if (!entry.endsWith(".tokens.json")) continue;
      const file = path.join(dir, folder.name, entry);
      try {
        exported.set(
          `${folder.name}/${entry}`,
          JSON.parse(readFileSync(file, "utf8")),
        );
      } catch (error) {
        throw new Error(`${file} is not valid JSON`, { cause: error });
      }
    }
  }
  if (exported.size === 0) {
    throw new Error(
      `${dir} holds no <collection>/<mode>.tokens.json files to import`,
    );
  }
  return exported;
}

function main(): number {
  const command = process.argv.at(2);
  const dir = process.argv.at(3);
  if ((command !== "export" && command !== "import") || dir === undefined) {
    console.error(USAGE);
    return 1;
  }
  const root = path.resolve(dir);

  if (command === "export") {
    const files = exportForFigma(TOKEN_FILES);
    for (const [relative, group] of files) {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, formatTokenFile(group));
    }
    console.log(
      `Wrote ${files.size} files to ${root}. In Figma, import each folder as a collection, one file per mode.`,
    );
    return 0;
  }

  let result;
  try {
    result = importFromFigma(readExport(root), TOKEN_FILES);
  } catch (error) {
    if (!(error instanceof TokenImportError)) throw error;
    console.error(error.message);
    return 1;
  }
  let written = 0;
  for (const [relative, group] of result.files) {
    const target = path.join(FILES_DIR, relative);
    const next = formatTokenFile(group);
    if (readFileSync(target, "utf8") === next) continue;
    writeFileSync(target, next);
    written += 1;
  }
  for (const [file, tokenPaths] of result.changed) {
    console.log(`${file}: ${tokenPaths.join(", ")}`);
  }
  if (written === 0) {
    console.log("No token changed.");
    return 0;
  }
  console.log(
    `Updated ${written} token files. Next: pnpm --filter @agent-native/design-system css, then review the diff.`,
  );
  return 0;
}

process.exitCode = main();
