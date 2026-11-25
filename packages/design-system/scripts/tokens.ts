import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  exportForFigma,
  formatTokenFile,
  importFromFigma,
  textStylesForFigma,
  TokenImportError,
} from "../src/tokens/round-trip.js";
import { TEXT_STYLE_DEFINITIONS, TOKEN_FILES } from "../src/tokens/source.js";

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
    writeFileSync(
      path.join(root, "text-styles.json"),
      formatTokenFile(textStylesForFigma(TEXT_STYLE_DEFINITIONS)),
    );
    console.log(
      `Wrote ${files.size} files to ${root}. In Figma, import each folder as a collection, one file per mode; text-styles.json lists the text styles for the Figma sync to create, bound to the Foundations variables.`,
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
    if (isDeepStrictEqual(JSON.parse(readFileSync(target, "utf8")), group))
      continue;
    writeFileSync(target, formatTokenFile(group));
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
