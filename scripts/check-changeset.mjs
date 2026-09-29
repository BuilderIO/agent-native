#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseDocument } from "yaml";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function getBaseSha() {
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

function listChangesetManagedPackages(ignoredPackages) {
  const packagesDir = path.join(repoRoot, "packages");
  if (!fs.existsSync(packagesDir)) {
    return { byDir: new Map(), names: new Set() };
  }

  const map = new Map();
  const names = new Set();
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
    if (!pkg.version) continue;
    if (ignoredPackages.has(pkg.name)) continue;
    map.set(entry.name, pkg.name);
    names.add(pkg.name);
  }
  return { byDir: map, names };
}

function listIgnoredPackages() {
  const configPath = path.join(repoRoot, ".changeset", "config.json");
  if (!fs.existsSync(configPath)) return new Set();
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return new Set(Array.isArray(config.ignore) ? config.ignore : []);
  } catch {
    return new Set();
  }
}

function packageFromPath(file, publishables) {
  const m = file.match(/^packages\/([^/]+)\//);
  if (!m) return null;
  const dirName = m[1];
  return publishables.get(dirName) ?? null;
}

function isVersionPackagesBumpOnly(file, baseSha) {
  if (/^packages\/[^/]+\/changelog\//.test(file)) return true;
  if (!file.endsWith("/package.json") && !file.endsWith("/CHANGELOG.md")) {
    return false;
  }
  try {
    const diff = sh(`git diff ${baseSha}...HEAD -- ${file}`);
    if (file.endsWith("CHANGELOG.md")) return true;
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

export function packagesCoveredBy(changesetPath) {
  const content = fs.readFileSync(changesetPath, "utf8");
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) {
    throw new Error(
      "Invalid changeset .changeset/" +
        path.basename(changesetPath) +
        ": expected YAML frontmatter between --- lines",
    );
  }
  const document = parseDocument(m[1], { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      "Invalid changeset .changeset/" +
        path.basename(changesetPath) +
        ": invalid YAML frontmatter",
      { cause: document.errors[0] },
    );
  }
  const entries = document.toJS();
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(
      "Invalid changeset .changeset/" +
        path.basename(changesetPath) +
        ": expected a YAML package-to-bump map",
    );
  }
  const packages = Object.entries(entries).map(([packageName, bump]) => {
    if (
      packageName.length === 0 ||
      typeof bump !== "string" ||
      !["none", "patch", "minor", "major"].includes(bump)
    ) {
      throw new Error(
        "Invalid changeset .changeset/" +
          path.basename(changesetPath) +
          ": expected package entries with none, patch, minor, or major bumps",
      );
    }
    return packageName;
  });
  if (packages.length === 0) {
    throw new Error(
      "Invalid changeset .changeset/" +
        path.basename(changesetPath) +
        ": no package bumps found",
    );
  }
  return packages;
}

function failOnSkippedChangesets(managedPackageNames) {
  for (const cs of listPendingChangesets()) {
    const packages = packagesCoveredBy(cs);
    const skipped = packages.filter((pkg) => !managedPackageNames.has(pkg));
    const managed = packages.filter((pkg) => managedPackageNames.has(pkg));
    if (skipped.length === 0) continue;

    console.error("✗ Changeset includes packages that are not versioned.");
    console.error("");
    console.error(`Changeset: .changeset/${path.basename(cs)}`);
    console.error(`Skipped packages: ${skipped.join(", ")}`);
    if (managed.length > 0) {
      console.error(`Versioned packages: ${managed.join(", ")}`);
    }
    console.error("");
    console.error(
      "These packages are not versioned by changesets in this repo. Leaving skipped packages in changesets can block the publish workflow with an empty Version Packages PR.",
    );
    console.error(
      "Remove skipped packages from the changeset. If the changeset only targets skipped packages, delete the changeset file.",
    );
    process.exit(1);
  }
}

function main() {
  const baseSha = getBaseSha();
  const ignoredPackages = listIgnoredPackages();
  const managedPackages = listChangesetManagedPackages(ignoredPackages);
  failOnSkippedChangesets(managedPackages.names);

  const changedFiles = listChangedFiles(baseSha);

  const touchedPackages = new Set();
  for (const file of changedFiles) {
    const pkg = packageFromPath(file, managedPackages.byDir);
    if (!pkg) continue;
    if (isVersionPackagesBumpOnly(file, baseSha)) continue;
    touchedPackages.add(pkg);
  }

  if (touchedPackages.size === 0) {
    console.log(
      "✓ No publishable package source changed; no changeset needed.",
    );
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

  console.error("✗ Missing changeset for publishable package source changes.");
  console.error("");
  console.error(
    `Touched publishable packages: ${[...touchedPackages].join(", ")}`,
  );
  console.error(
    `Covered by existing changesets: ${[...covered].join(", ") || "(none)"}`,
  );
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

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
