#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  ".cache",
  ".claude",
  ".git",
  ".next",
  ".netlify",
  ".nuxt",
  ".output",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const PATCH_COMMAND_RE =
  /\bpnpm(?:\s+(?:--[^\s]+|-[^\s]+))*\s+patch(?:-commit)?\b/;
const PATCH_LOCK_RE = /\b(?:patchedDependencies|patch_hash):/;

export type PnpmPatchViolation = {
  file: string;
  location: string;
  detail: string;
};

export function checkPnpmPatches(root: string): PnpmPatchViolation[] {
  const violations: PnpmPatchViolation[] = [];

  for (const file of walk(root)) {
    const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
    const segments = relativeFile.split("/");

    if (segments.includes("patches")) {
      violations.push({
        file: relativeFile,
        location: "path",
        detail: "package-manager patch artifact under a patches/ directory",
      });
      continue;
    }

    const base = path.basename(file);
    if (base === "package.json") {
      scanPackageJson(file, relativeFile, violations);
      continue;
    }

    if (base === "pnpm-lock.yaml" || base === "pnpm-workspace.yaml") {
      scanPnpmYaml(file, relativeFile, violations);
    }
  }

  return violations;
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(file);
    } else if (entry.isFile()) {
      yield file;
    }
  }
}

function scanPackageJson(
  file: string,
  relativeFile: string,
  violations: PnpmPatchViolation[],
) {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }

  if (!isRecord(manifest)) return;

  const pnpm = manifest.pnpm;
  if (isRecord(pnpm) && "patchedDependencies" in pnpm) {
    violations.push({
      file: relativeFile,
      location: "pnpm.patchedDependencies",
      detail: "patchedDependencies changes the installed package contents",
    });
  }

  const scripts = manifest.scripts;
  if (!isRecord(scripts)) return;

  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string" || !PATCH_COMMAND_RE.test(command)) {
      continue;
    }
    violations.push({
      file: relativeFile,
      location: `scripts.${name}`,
      detail: "package script invokes pnpm patch or pnpm patch-commit",
    });
  }
}

function scanPnpmYaml(
  file: string,
  relativeFile: string,
  violations: PnpmPatchViolation[],
) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const [index, line] of source.split("\n").entries()) {
    if (!PATCH_LOCK_RE.test(line)) continue;
    violations.push({
      file: relativeFile,
      location: `line ${index + 1}`,
      detail: "pnpm metadata records a package patch",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main() {
  const violations = checkPnpmPatches(REPO_ROOT);
  if (violations.length === 0) {
    console.log(
      "guard-no-pnpm-patches: clean (no pnpm package patches found).",
    );
    return;
  }

  console.error(
    `guard-no-pnpm-patches: ${violations.length} forbidden package patch artifact(s) found.`,
  );
  console.error(
    "\nDo not use pnpm patching to repair dependency behavior. Upgrade the dependency, fix app-owned code, or stop and ask for an upstream fix.\n",
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file} (${violation.location})\n    ${violation.detail}`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
