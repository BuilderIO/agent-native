#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = "scripts/guard-agent-native-brand.ts";
const LEGACY_ASSET_RE = /\bagent[ \t]+native(?:[ \t]+nightly)?-/gi;
const SPACED_BRAND_RE = /\bagent[ \t]+native(?![-A-Za-z])/gi;
const WRONG_TITLE_CASE_RE = /\bAgent-native\b/g;
const BRAND_PRAGMA_RE = /\/\/\s*agent-native-brand-ok:/i;

export interface BrandFile {
  path: string;
  text: string;
}

function hasBrandPragma(lines: readonly string[], lineNumber: number): boolean {
  return (
    BRAND_PRAGMA_RE.test(lines[lineNumber - 1] ?? "") ||
    BRAND_PRAGMA_RE.test(lines[lineNumber - 2] ?? "")
  );
}

export function findBrandViolations(files: readonly BrandFile[]): string[] {
  const violations: string[] = [];

  for (const file of files) {
    if (file.path === SELF_PATH) continue;

    const lines = file.text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (hasBrandPragma(lines, index + 1)) continue;

      const lineWithoutLegacyAssets = line.replace(LEGACY_ASSET_RE, "legacy-");
      SPACED_BRAND_RE.lastIndex = 0;
      WRONG_TITLE_CASE_RE.lastIndex = 0;
      if (
        SPACED_BRAND_RE.test(lineWithoutLegacyAssets) ||
        WRONG_TITLE_CASE_RE.test(line)
      ) {
        violations.push(`${file.path}:${index + 1}`);
      }
    }
  }

  return violations;
}

function readCandidateFiles(): BrandFile[] {
  const files = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

  return files.flatMap((file) => {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return [];
    const buffer = readFileSync(file);
    if (buffer.includes(0)) return [];
    return [{ path: file, text: buffer.toString("utf8") }];
  });
}

export function main(): void {
  const files = readCandidateFiles();
  const violations = findBrandViolations(files);
  if (violations.length > 0) {
    console.error(
      [
        "Undashed Agent-Native branding found:",
        "",
        ...violations.map((violation) => `  - ${violation}`),
        "",
        "Use Agent-Native for the product name. Keep technical identifiers and legacy asset aliases unchanged.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`guard:agent-native-brand: clean (${files.length} files)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
