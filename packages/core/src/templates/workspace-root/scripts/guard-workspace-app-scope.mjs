#!/usr/bin/env node
// Fast-feedback scope guard for a Builder workspace app branch. Fails if any
// changed path is outside apps/<id>/ (pnpm-lock.yaml is allowed; a
// pnpm-workspace.yaml change only warns). Builder's own scope check is the
// authoritative one; this keeps an app session from drifting into shared files.
//
// Usage: WORKSPACE_APP_ID=<id> pnpm guard:workspace-app-scope
//        pnpm guard:workspace-app-scope <id> [--base origin/main]
// Keep the classification in sync with `classifyWorkspacePath` in Builder.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP_ID_REGEX = /^[a-z][a-z0-9-]{0,39}$/;
const DERIVED_PATHS = ["pnpm-lock.yaml"];

export function classifyWorkspacePath(appId, path) {
  const normalized = path.replace(/^\.?\/+/, "");
  if (normalized.startsWith(`apps/${appId}/`)) return "app";
  if (DERIVED_PATHS.includes(normalized)) return "derived-lockfile";
  if (normalized === "pnpm-workspace.yaml") return "pnpm-config";
  if (normalized.startsWith(".github/")) return "ci";
  if (normalized.startsWith("apps/")) return "other-app";
  return "root";
}

export function checkWorkspaceAppScope(appId, changedPaths) {
  const violations = [];
  const warnings = [];
  for (const path of changedPaths) {
    const cls = classifyWorkspacePath(appId, path);
    if (cls === "app" || cls === "derived-lockfile") continue;
    if (cls === "pnpm-config") warnings.push(path);
    else violations.push({ path, class: cls });
  }
  return { violations, warnings };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function changedPaths(base) {
  const mergeBase = git(["merge-base", base, "HEAD"]);
  const tracked = git(["diff", "--name-only", "--no-renames", mergeBase]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [
    ...new Set([...tracked.split("\n"), ...untracked.split("\n")]),
  ].filter(Boolean);
}

function main() {
  const argv = process.argv.slice(2);
  let base = "origin/main";
  let appId = process.env.WORKSPACE_APP_ID;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) base = argv[++i];
    else if (!argv[i].startsWith("-")) appId = argv[i];
  }
  if (!appId || !APP_ID_REGEX.test(appId)) {
    console.error(
      "guard:workspace-app-scope: set WORKSPACE_APP_ID (or pass an app id) matching /^[a-z][a-z0-9-]{0,39}$/.",
    );
    process.exit(2);
  }
  let paths;
  try {
    paths = changedPaths(base);
  } catch (error) {
    console.error(
      `guard:workspace-app-scope: could not diff against ${base} (${error instanceof Error ? error.message : error}). Fetch it first.`,
    );
    process.exit(2);
  }
  const { violations, warnings } = checkWorkspaceAppScope(appId, paths);
  for (const path of warnings) {
    console.warn(
      `warn: ${path} changed; only additions that Builder classifies as catalog-only stay app-scoped.`,
    );
  }
  if (violations.length > 0) {
    console.error(
      `guard:workspace-app-scope failed: changes outside apps/${appId}/ need a workspace request:`,
    );
    for (const v of violations) console.error(`  ${v.path} (${v.class})`);
    process.exit(1);
  }
  console.log(`guard:workspace-app-scope ok (${paths.length} changed paths).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
