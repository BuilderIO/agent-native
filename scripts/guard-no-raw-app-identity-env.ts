import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(rootDir, "packages", "core", "src");
const identityEnvRead =
  /\bprocess\s*\.\s*env\s*(?:\.\s*(?:APP_NAME|AGENT_APP|VITE_APP_NAME)\b|\[\s*["'](?:APP_NAME|AGENT_APP|VITE_APP_NAME)["']\s*\])/;

export function findRawAppIdentityEnvReads(
  addedLines: ReadonlyMap<string, ReadonlySet<number>>,
  readFile: (file: string) => string,
  root = rootDir,
): string[] {
  const findings: string[] = [];
  const coreSource = path.join(root, "packages", "core", "src");
  for (const [file, lines] of addedLines) {
    const relative = path.relative(coreSource, file);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).includes("app-config") ||
      !/\.[cm]?[jt]sx?$/.test(file)
    ) {
      continue;
    }

    const source = readFile(file).split(/\r?\n/);
    for (const lineNumber of lines) {
      const line = source[lineNumber - 1] ?? "";
      if (identityEnvRead.test(line)) {
        findings.push(
          `${path.relative(root, file)}:${lineNumber}: ${line.trim()}`,
        );
      }
    }
  }
  return findings.sort();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const addedLines = requireAddedLines(
    rootDir,
    "guard:no-raw-app-identity-env",
  );
  const findings = findRawAppIdentityEnvReads(addedLines, (file) =>
    readFileSync(file, "utf8"),
  );

  if (findings.length > 0) {
    console.error(
      `[guard:no-raw-app-identity-env] ${findings.length} raw app identity environment read(s):`,
    );
    for (const finding of findings) console.error(`- ${finding}`);
    console.error(
      "Declare APP_NAME, AGENT_APP, or VITE_APP_NAME under packages/core/src/app-config and read it through getAppConfig().",
    );
    process.exit(1);
  }

  console.log(
    "[guard:no-raw-app-identity-env] no new raw app identity environment reads",
  );
}
