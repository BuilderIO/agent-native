#!/usr/bin/env node
/**
 * Fails CI on a PR if any publishable package's source code changed
 * without a corresponding changeset. The error message is structured so
 * `/babysit-pr` can parse the missing-package list and write the
 * `.changeset/*.md` file automatically.
 *
 * Algorithm:
 *   1. Diff against `origin/main` to get the list of files this PR
 *      changes.
 *   2. Map each changed file to a publishable package (anything under
 *      `packages/<name>/` where `packages/<name>/package.json` is NOT
 *      `private: true`). Ignore changes to `package.json` itself if
 *      it's just a version bump from a Version Packages PR.
 *   3. Read every `.changeset/*.md` (excluding `README.md` + `config.json`)
 *      and parse the YAML frontmatter for the `"@scope/pkg": bump` map.
 *   4. If any touched-but-uncovered package remains, print the structured
 *      error and exit 1.
 *
 * Run via: `node scripts/check-changeset.mjs`
 * Used by: `.github/workflows/changeset-check.yml`
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function getBaseSha() {
  // GitHub Actions sets GITHUB_BASE_REF on PRs (e.g. "main"). For local
  // runs, fall back to origin/main.
  if (process.env.GITHUB_BASE_REF) {
    sh(`git fetch origin ${process.env.GITHUB_BASE_REF} --depth=50`);
    return sh(`git rev-parse origin/${process.env.GITHUB_BASE_REF}`);
  }
  return sh("git rev-parse origin/main");
}

function listChangedFiles(baseSha) {
  return sh(`git diff --name-only ${baseSha}...HEAD`)
    .split("\n")
    .filter(Boolean);
}

function listPublishablePackages() {
  const packagesDir = path.join(repoRoot, "packages");
  if (!fs.existsSync(packagesDir)) return new Map();

  const map = new Map(); // packageDirName → packageName
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }
    if (pkg.private === true) continue;
    if (!pkg.name) continue;
    map.set(entry.name, pkg.name);
  }
  return map;
}

function packageFromPath(file, publishables) {
  // packages/<name>/...  → <name>
  const m = file.match(/^packages\/([^/]+)\//);
  if (!m) return null;
  const dirName = m[1];
  return publishables.get(dirName) ?? null;
}

function isVersionPackagesBumpOnly(file, baseSha) {
  // The Version Packages PR bumps `version` + appends to CHANGELOG.md.
  // If those are the ONLY files touched in a package, no changeset is
  // needed (the bump itself is what consumes the changesets).
  if (!file.endsWith("/package.json") && !file.endsWith("/CHANGELOG.md")) {
    return false;
  }
  try {
    const diff = sh(`git diff ${baseSha}...HEAD -- ${file}`);
    if (file.endsWith("CHANGELOG.md")) return true;
    // For package.json — accept if the only changed line is `"version":`.
    const changedLines = diff
      .split("\n")
      .filter((l) => /^[+-][^+-]/.test(l))
      .filter((l) => !l.match(/^[+-]\s*"version":/));
    return changedLines.length === 0;
  } catch {
    return false;
  }
}

function listPendingChangesets() {
  const dir = path.join(repoRoot, ".changeset");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => path.join(dir, f));
}

function packagesCoveredBy(changesetPath) {
  const content = fs.readFileSync(changesetPath, "utf8");
  // Frontmatter is between two `---` lines at the top.
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Lines look like:  "@agent-native/core": patch
      const mm = line.match(/^["']?([^"':]+)["']?\s*:\s*(\w+)\s*$/);
      return mm ? mm[1].trim() : null;
    })
    .filter(Boolean);
}

function main() {
  const baseSha = getBaseSha();
  const publishables = listPublishablePackages();
  const changedFiles = listChangedFiles(baseSha);

  const touchedPackages = new Set();
  for (const file of changedFiles) {
    const pkg = packageFromPath(file, publishables);
    if (!pkg) continue;
    if (isVersionPackagesBumpOnly(file, baseSha)) continue;
    touchedPackages.add(pkg);
  }

  if (touchedPackages.size === 0) {
    console.log("✓ No publishable package source changed; no changeset needed.");
    process.exit(0);
  }

  const covered = new Set();
  for (const cs of listPendingChangesets()) {
    for (const pkg of packagesCoveredBy(cs)) covered.add(pkg);
  }

  const missing = [...touchedPackages].filter((p) => !covered.has(p));
  if (missing.length === 0) {
    console.log(
      `✓ All touched publishable packages have changesets: ${[...touchedPackages].join(", ")}`,
    );
    process.exit(0);
  }

  // Structured failure — babysit-pr parses this to know what to add.
  console.error("✗ Missing changeset for publishable package source changes.");
  console.error("");
  console.error(`Touched publishable packages: ${[...touchedPackages].join(", ")}`);
  console.error(`Covered by existing changesets: ${[...covered].join(", ") || "(none)"}`);
  console.error(`MISSING_CHANGESET_PACKAGES: ${missing.join(",")}`);
  console.error("");
  console.error("To add one locally:");
  console.error("  pnpm changeset add");
  console.error("");
  console.error(
    "Or write `.changeset/<descriptive-slug>.md` with frontmatter like:",
  );
  console.error("");
  console.error("  ---");
  for (const pkg of missing) {
    console.error(`  "${pkg}": patch`);
  }
  console.error("  ---");
  console.error("");
  console.error("  One-line summary of the change.");
  process.exit(1);
}

main();
