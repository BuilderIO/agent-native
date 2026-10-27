import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { scanReleaseSchemaCoverage } from "../packages/core/src/guards/release-schema-complete.js";
import {
  STORE_MIGRATIONS_LOCK_FILE,
  buildStoreMigrationsLock,
  compareStoreMigrationsLocks,
  type StoreMigrationsLock,
} from "../packages/core/src/guards/store-migrations-lock.js";
import { discoverStores } from "../packages/core/src/guards/store-registry-codegen.js";
import type { GuardFinding } from "../packages/core/src/guards/types.js";
import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const root = process.cwd();
const coreDir = path.join(root, "packages", "core");
const lockPath = path.join(coreDir, STORE_MIGRATIONS_LOCK_FILE);
const lockRepoPath = `packages/core/${STORE_MIGRATIONS_LOCK_FILE}`;

const findings: GuardFinding[] = [
  ...scanReleaseSchemaCoverage({ root }).findings,
];

const stores = await Promise.all(
  discoverStores(coreDir).map(async (store) => {
    const mod = await import(
      pathToFileURL(path.join(coreDir, store.file)).href
    );
    return mod[store.exportName];
  }),
);
const current = buildStoreMigrationsLock(stores);

let committed: StoreMigrationsLock | undefined;
if (fs.existsSync(lockPath)) {
  committed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (JSON.stringify(committed) !== JSON.stringify(current)) {
    findings.push({
      file: STORE_MIGRATIONS_LOCK_FILE,
      line: 1,
      message:
        "is stale: it does not match the declared store migrations; run `pnpm gen:store-registry`.",
    });
  }
} else {
  findings.push({
    file: STORE_MIGRATIONS_LOCK_FILE,
    line: 1,
    message: "is missing; run `pnpm gen:store-registry`.",
  });
}

const base = resolveDiffBase(root);
if (!base) {
  console.error(
    "guard-release-schema-complete: no base ref (GUARD_DIFF_BASE/GITHUB_BASE_REF, origin/main or main), so store migrations could not be checked for append-only edits.\n  Fix with:  git fetch origin main",
  );
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function couldNotRun(reason: string): never {
  console.error(
    `guard-release-schema-complete: ${reason}, so store migrations could not be checked for append-only edits.`,
  );
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}

let mergeBase: string;
try {
  mergeBase = git(["merge-base", base, "HEAD"]).trim();
} catch {
  couldNotRun(`no merge base between ${base} and HEAD`);
}
// Absent on the base is the only reason to skip the comparison; a lock that
// exists but cannot be read is a failure to check, not a pass.
let baseLock: StoreMigrationsLock | undefined;
let baseHasLock = true;
try {
  git(["cat-file", "-e", `${mergeBase}:${lockRepoPath}`]);
} catch {
  baseHasLock = false;
}
if (baseHasLock) {
  try {
    baseLock = JSON.parse(git(["show", `${mergeBase}:${lockRepoPath}`]));
  } catch (err) {
    couldNotRun(
      `the base ${lockRepoPath} exists but could not be read (${(err as Error).message})`,
    );
  }
}
if (baseLock) findings.push(...compareStoreMigrationsLocks(baseLock, current));

if (findings.length > 0) {
  console.error(
    [
      "Framework schema is not owned by a registered, append-only store:",
      "",
      ...findings.map(
        (finding) => `  - ${finding.file}:${finding.line}: ${finding.message}`,
      ),
      "",
      "Declare schema with defineStore() from packages/core/src/db/store-registry.ts, append",
      "migrations (never edit, rename, reorder or delete one), then run `pnpm gen:store-registry`.",
      "For a reviewed exception to schema placement, add",
      "// guard:allow-unreleased-schema — <reason> to the file.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Store registry and migration lock are fresh, append-only${
    baseLock ? "" : " (base has no lock yet)"
  }, and cover every module that defines schema (${stores.length} stores).`,
);
