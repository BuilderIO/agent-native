#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const targetName = process.argv[2];
const repoRoot = process.cwd();

const globalPaths = [
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/netlify-ignore-build.mjs",
];

if (!targetName) {
  console.error("[netlify-ignore] Missing template/package name argument.");
  process.exit(1);
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, filePath), "utf8"));
}

function packageDirsUnder(parentDir) {
  const absParent = path.join(repoRoot, parentDir);

  if (!existsSync(absParent)) {
    return [];
  }

  return readdirSync(absParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parentDir}/${entry.name}`)
    .filter((dir) => existsSync(path.join(repoRoot, dir, "package.json")));
}

function workspacePackages() {
  const packages = new Map();

  for (const dir of [
    ...packageDirsUnder("packages"),
    ...packageDirsUnder("templates"),
  ]) {
    const pkg = readJson(`${dir}/package.json`);

    if (pkg.name) {
      packages.set(pkg.name, { dir, pkg });
    }
  }

  return packages;
}

function dependencyNames(pkg) {
  return [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ].flatMap((deps) => (deps ? Object.keys(deps) : []));
}

function targetPackage(packages) {
  if (packages.has(targetName)) {
    return packages.get(targetName);
  }

  const templateDir = `templates/${targetName}`;
  const match = [...packages.values()].find(({ dir }) => dir === templateDir);

  return match ?? null;
}

function watchedPathsForTarget(packages, target) {
  const watched = new Set(globalPaths);
  const queue = [target];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || seen.has(current.pkg.name)) {
      continue;
    }

    seen.add(current.pkg.name);
    watched.add(current.dir);

    for (const dependencyName of dependencyNames(current.pkg)) {
      const dependency = packages.get(dependencyName);

      if (dependency && !seen.has(dependency.pkg.name)) {
        queue.push(dependency);
      }
    }
  }

  return [...watched].sort();
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitExists(ref) {
  if (!ref || /^0+$/.test(ref)) {
    return false;
  }

  try {
    git(["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles() {
  const cachedRef = process.env.CACHED_COMMIT_REF;
  const commitRef = process.env.COMMIT_REF;

  if (!commitExists(cachedRef) || !commitExists(commitRef)) {
    console.log(
      "[netlify-ignore] Build required: Netlify did not provide comparable commit refs.",
    );
    return null;
  }

  try {
    return git(["diff", "--name-only", cachedRef, commitRef])
      .split("\n")
      .map((file) => normalizePath(file.trim()))
      .filter(Boolean);
  } catch (error) {
    console.log(
      `[netlify-ignore] Build required: git diff failed (${error.message}).`,
    );
    return null;
  }
}

function pathMatches(filePath, watchedPath) {
  return filePath === watchedPath || filePath.startsWith(`${watchedPath}/`);
}

const packages = workspacePackages();
const target = targetPackage(packages);

if (!target) {
  console.error(`[netlify-ignore] Unknown template/package: ${targetName}`);
  process.exit(1);
}

const watchedPaths = watchedPathsForTarget(packages, target);
const files = changedFiles();

if (!files) {
  process.exit(1);
}

const matchedFile = files.find((file) =>
  watchedPaths.some((watchedPath) => pathMatches(file, watchedPath)),
);

if (matchedFile) {
  console.log(
    `[netlify-ignore] Build required for ${target.pkg.name}: ${matchedFile} changed.`,
  );
  process.exit(1);
}

console.log(
  `[netlify-ignore] Skipping ${target.pkg.name}: no changes in ${watchedPaths.join(
    ", ",
  )}.`,
);
process.exit(0);
