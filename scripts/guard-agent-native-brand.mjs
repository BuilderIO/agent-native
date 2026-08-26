#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const spacedBrand = /\bagent[ \t]+native(?![-A-Za-z])/gi;
const wrongTitleCase = /\bAgent-native\b/g;
const violations = [];

for (const file of files) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    spacedBrand.lastIndex = 0;
    wrongTitleCase.lastIndex = 0;
    if (spacedBrand.test(line) || wrongTitleCase.test(line)) {
      violations.push(`${file}:${index + 1}`);
    }
  }
}

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
  process.exit(1);
}

console.log(`guard:agent-native-brand: clean (${files.length} tracked files)`);
