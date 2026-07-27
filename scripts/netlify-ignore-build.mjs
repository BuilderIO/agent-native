#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const targetName = process.argv[2];
const repoRoot = process.cwd();

const retiredTargets = new Set([
  "calls",
  "code",
  "contracts",
  "images",
  "issues",
  "meeting-notes",
  "migration",
  "recruiting",
  "scheduling",
  "visual-plans",
  "voice",
  "workbench",
]);

export const globalPaths = [
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/netlify-ignore-build.mjs",
];

export const VERSION_PACKAGES_SUBJECT_RE = /^chore:\s*version packages\b/i;

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}

function main() {
  if (!targetName) {
    console.error("[netlify-ignore] Missing template/package name argument.");
    process.exit(1);
  }

  if (retiredTargets.has(targetName)) {
    console.log(
      `[netlify-ignore] Skipping retired Netlify site: ${targetName}.`,
    );
    process.exit(0);
  }

  const commitRef = process.env.COMMIT_REF;
  if (commitExists(commitRef) && isVersionPackagesRelease(commitRef)) {
    console.log(
      `[netlify-ignore] Skipping ${targetName}: version-packages release commit ${commitRef.slice(
        0,
        8,
      )} changes no deployed output.`,
    );
    process.exit(0);
  }

  const packages = workspacePackages();
  const target = targetPackage(packages, targetName);

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

  const supersedingMain = commitExists(commitRef)
    ? supersedingProductionMainCommit(commitRef)
    : null;

  if (matchedFile) {
    if (supersedingMain) {
      const newerTouch = newerNonVersionPackagesTouch(
        commitRef,
        supersedingMain,
        watchedPaths,
      );
      if (newerTouch === null) {
        process.exit(1);
      }

      if (newerTouch) {
        console.log(
          `[netlify-ignore] Skipping ${target.pkg.name}: production commit ${commitRef.slice(
            0,
            8,
          )} was superseded by ${newerTouch.commit.slice(
            0,
            8,
          )}, which also changes ${newerTouch.file}.`,
        );
        process.exit(0);
      }

      console.log(
        `[netlify-ignore] Build still required for ${target.pkg.name}: ${matchedFile} changed, and newer origin/main commits do not change this target.`,
      );
      process.exit(1);
    }

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

function targetPackage(packages, name) {
  if (packages.has(name)) {
    return packages.get(name);
  }

  const templateDir = `templates/${name}`;
  const match = [...packages.values()].find(({ dir }) => dir === templateDir);

  return match ?? null;
}

export function watchedPathsForTarget(packages, target) {
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

function isAncestor(ancestorRef, descendantRef) {
  try {
    git(["merge-base", "--is-ancestor", ancestorRef, descendantRef]);
    return true;
  } catch {
    return false;
  }
}

function firstParent(ref) {
  try {
    return git(["rev-parse", `${ref}^1`]);
  } catch {
    return null;
  }
}

function commitSubject(ref) {
  try {
    return git(["log", "-1", "--format=%s", ref]);
  } catch {
    return "";
  }
}

// The changeset "Version Packages" PR is squash-merged to main with a title
// like `chore: version packages (#NNNN)` (see auto-publish.yml and
// auto-merge-version-packages.yml). Those commits only bump package versions,
// regenerate pnpm-lock.yaml, rewrite CHANGELOGs, and delete .changeset/*.md.
// But pnpm-lock.yaml and package.json are in `globalPaths`, so every release
// commit otherwise enqueues a build for the whole fleet.
export function isVersionPackagesSubject(subject) {
  return VERSION_PACKAGES_SUBJECT_RE.test(subject);
}

function isVersionPackagesRelease(ref) {
  return isVersionPackagesSubject(commitSubject(ref));
}

function isProductionBuild() {
  const context = process.env.CONTEXT || process.env.NETLIFY_CONTEXT || "";

  if (context) {
    return context === "production";
  }

  return process.env.PULL_REQUEST !== "true" && process.env.BRANCH === "main";
}

function remoteMainRef() {
  try {
    return git(["rev-parse", "origin/main^{commit}"]);
  } catch {
    return null;
  }
}

function supersedingProductionMainCommit(ref) {
  if (!isProductionBuild()) {
    return null;
  }

  const latestMain = remoteMainRef();
  if (!latestMain || latestMain === ref) {
    return null;
  }

  return isAncestor(ref, latestMain) ? latestMain : null;
}

function changedFilesBetween(baseRef, headRef) {
  try {
    return git(["diff", "--name-only", baseRef, headRef])
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

function listCommitsBetween(baseRef, headRef) {
  try {
    return git(["rev-list", "--reverse", `${baseRef}..${headRef}`])
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    console.log(
      `[netlify-ignore] Build required: git rev-list failed (${error.message}).`,
    );
    return null;
  }
}

/**
 * Return the first non-version-packages commit after `baseRef` (up to
 * `headRef`) that touches a watched path, or `false` when none do.
 *
 * Version Packages releases intentionally skip every Netlify site, but they
 * still rewrite package manifests and changelogs under watched package dirs.
 * An aggregate `git diff base..tip` therefore looks like a
 * "newer build that also changes this site" and cancels the real deploy that
 * the release followed. Inspect commits one-by-one and ignore version-packages
 * subjects so only a later deployable commit can supersede.
 *
 * Returns `null` when git failed (caller should fail open and build).
 */
export function findSupersedingTouch(opts) {
  const {
    commits,
    isVersionPackages,
    filesForCommit,
    watchedPaths,
    pathMatchesFn = pathMatches,
  } = opts;

  for (const sha of commits) {
    if (isVersionPackages(sha)) {
      continue;
    }

    const files = filesForCommit(sha);
    if (files === null) {
      return null;
    }

    const matchedFile = files.find((file) =>
      watchedPaths.some((watchedPath) => pathMatchesFn(file, watchedPath)),
    );

    if (matchedFile) {
      return { commit: sha, file: matchedFile };
    }
  }

  return false;
}

function newerNonVersionPackagesTouch(baseRef, headRef, watchedPaths) {
  const commits = listCommitsBetween(baseRef, headRef);
  if (!commits) {
    return null;
  }

  return findSupersedingTouch({
    commits,
    isVersionPackages: isVersionPackagesRelease,
    filesForCommit: (sha) => {
      const parent = firstParent(sha);
      if (!parent) {
        return null;
      }
      return changedFilesBetween(parent, sha);
    },
    watchedPaths,
  });
}

function changedFiles() {
  const cachedRef = process.env.CACHED_COMMIT_REF;
  const commitRef = process.env.COMMIT_REF;

  if (!commitExists(commitRef)) {
    console.log(
      "[netlify-ignore] Build required: Netlify did not provide a comparable commit ref.",
    );
    return null;
  }

  // Pick the base commit to diff against. Normally that's CACHED_COMMIT_REF
  // (the last commit Netlify built for this site). BUT Netlify shares the build
  // cache across deploy contexts: after a PR's deploy-preview builds, the
  // production deploy of the squash-merge commit inherits CACHED_COMMIT_REF =
  // the preview head. That commit has an identical tree to the merge commit, so
  // the diff comes back empty and the site is wrongly skipped ("no content
  // change") even though the change really did land on main. Detect that case —
  // the cached ref is missing or is NOT an ancestor of the commit being built —
  // and diff against the commit's first parent instead (the true previous state
  // on this branch), so per-site change detection stays correct on production.
  let baseRef = cachedRef;
  if (!commitExists(cachedRef) || !isAncestor(cachedRef, commitRef)) {
    const parent = firstParent(commitRef);
    if (!parent) {
      console.log(
        "[netlify-ignore] Build required: no usable comparison base (cached ref unusable and commit has no parent).",
      );
      return null;
    }
    console.log(
      `[netlify-ignore] CACHED_COMMIT_REF ${cachedRef || "(unset)"} is not an ancestor of ${commitRef} (shared deploy-preview cache); diffing against parent ${parent.slice(0, 8)} instead.`,
    );
    baseRef = parent;
  }

  return changedFilesBetween(baseRef, commitRef);
}

export function pathMatches(filePath, watchedPath) {
  return filePath === watchedPath || filePath.startsWith(`${watchedPath}/`);
}
