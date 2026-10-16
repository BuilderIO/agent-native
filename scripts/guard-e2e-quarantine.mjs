#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findDesignE2ETestRegistrations } from "./design-e2e-regression-pins.ts";
import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const E2E_DIR = "templates/design/e2e";
const EXCEPTIONS_PATH = "scripts/design-e2e-coverage-exceptions.json";
const CEILINGS = { [E2E_DIR]: 227 };
const SKIP_CEILINGS = { [E2E_DIR]: 7 };

function key(file, title) {
  return JSON.stringify([file, title]);
}

function describe(item) {
  return `${item.file}: ${item.title}`;
}

function isSuppressed(item) {
  return item.suppressionKind != null || item.modifier != null;
}

function suppressionIdentity(item) {
  const identity =
    item.modifier !== undefined
      ? `modifier:${item.modifier}`
      : `kind:${item.suppressionKind}`;
  const fingerprint =
    typeof item.suppressionFingerprint === "string"
      ? item.suppressionFingerprint
      : typeof item.suppressionReason === "string"
        ? item.suppressionReason.replace(/\s+at line \d+$/, "")
        : undefined;
  return fingerprint === undefined ? identity : `${identity}:${fingerprint}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function listSpecFiles(directory, relative = "") {
  const files = [];
  for (const entry of readdirSync(path.join(directory, relative), {
    withFileTypes: true,
  })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...listSpecFiles(directory, child));
    else if (entry.isFile() && entry.name.endsWith(".spec.ts"))
      files.push(child);
  }
  return files.sort();
}

function failToRun(message) {
  const error = new Error(message);
  Object.assign(error, { exitCode: GUARD_EXIT_COULD_NOT_RUN });
  throw error;
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    failToRun(
      `git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function resolveQuarantineBaseCommit(cwd) {
  const isPullRequest = ["pull_request", "pull_request_target"].includes(
    process.env.GITHUB_EVENT_NAME ?? "",
  );
  if (
    isPullRequest &&
    !process.env.GUARD_DIFF_BASE?.trim() &&
    !process.env.GITHUB_BASE_REF?.trim()
  ) {
    failToRun(
      "GitHub pull request runs must provide GITHUB_BASE_REF so quarantine is compared with the PR target",
    );
  }
  const base = resolveDiffBase(cwd);
  if (!base || base === "main") {
    failToRun(
      "could not determine the PR base from an origin ref; fetch the target branch or set GUARD_DIFF_BASE",
    );
  }
  const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  if (!mergeBase) failToRun(`git merge-base returned no commit for ${base}`);
  return mergeBase;
}

export function readBaseRegistrations(cwd, baseCommit) {
  const files = git(
    ["ls-tree", "-r", "--name-only", baseCommit, "--", E2E_DIR],
    cwd,
  )
    .split("\n")
    .filter((file) => file.endsWith(".spec.ts"));
  if (files.length === 0) failToRun(`${E2E_DIR} has no base *.spec.ts files`);

  const registrations = [];
  for (const file of files) {
    const source = git(["show", `${baseCommit}:${file}`], cwd);
    registrations.push(
      ...findDesignE2ETestRegistrations(
        source,
        file.slice(`${E2E_DIR}/`.length),
      ),
    );
  }
  return registrations;
}

export function readHeadRegistrations(cwd) {
  let files;
  try {
    files = listSpecFiles(path.join(cwd, E2E_DIR));
  } catch (error) {
    failToRun(`cannot read ${E2E_DIR}: ${error.message}`);
  }
  if (files.length === 0) failToRun(`${E2E_DIR} has no *.spec.ts files`);

  const registrations = [];
  for (const file of files) {
    let source;
    try {
      source = readFileSync(
        path.join(cwd, E2E_DIR, ...file.split("/")),
        "utf8",
      );
    } catch (error) {
      failToRun(`cannot read ${E2E_DIR}/${file}: ${error.message}`);
    }
    registrations.push(...findDesignE2ETestRegistrations(source, file));
  }
  return registrations;
}

function exceptionFieldsValid(exception, action) {
  if (
    !exception ||
    typeof exception !== "object" ||
    exception.action !== action ||
    typeof exception.reason !== "string" ||
    !exception.reason.trim() ||
    typeof exception.evidence !== "string" ||
    !exception.evidence.trim()
  ) {
    return false;
  }
  return true;
}

function validExpiry(value, today) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value > today
  );
}

export function compareQuarantineSnapshots(
  baseRegistrations,
  headRegistrations,
  exceptions,
  today = new Date().toISOString().slice(0, 10),
  baseExceptions = [],
) {
  const violations = [];
  const baseSuppressed = baseRegistrations.filter(isSuppressed);
  const baseByKey = new Map();
  const headByKey = new Map();
  const checkDuplicates = (registrations, label) => {
    const seen = new Set();
    for (const item of registrations) {
      const id = key(item.file, item.title);
      if (seen.has(id)) {
        violations.push(`duplicate ${label} test identity: ${describe(item)}`);
      }
      seen.add(id);
    }
  };
  checkDuplicates(baseRegistrations, "base");
  checkDuplicates(headRegistrations, "head");

  for (const item of baseRegistrations) {
    const id = key(item.file, item.title);
    baseByKey.set(id, item);
  }
  for (const item of headRegistrations) {
    const id = key(item.file, item.title);
    const matches = headByKey.get(id) ?? [];
    matches.push(item);
    headByKey.set(id, matches);
  }

  if (!Array.isArray(exceptions)) {
    return [...violations, "quarantine exceptions must be an array"];
  }
  const historicalCounts = new Map();
  for (const exception of baseExceptions) {
    const id = stableJson(exception);
    historicalCounts.set(id, (historicalCounts.get(id) ?? 0) + 1);
  }
  const historicalIndexes = new Set();
  const fingerprints = new Set();
  for (const [index, exception] of exceptions.entries()) {
    const id = stableJson(exception);
    if (fingerprints.has(id)) {
      violations.push(
        `duplicate quarantine exception at registry entry ${index + 1}`,
      );
    }
    fingerprints.add(id);
    const remaining = historicalCounts.get(id) ?? 0;
    if (remaining > 0) {
      historicalIndexes.add(index);
      historicalCounts.set(id, remaining - 1);
    }
  }

  const used = new Set();
  const newRenameTargetSources = new Map();
  for (const [index, exception] of exceptions.entries()) {
    if (
      historicalIndexes.has(index) ||
      exception?.action !== "rename" ||
      !exception.to ||
      typeof exception.to.file !== "string" ||
      typeof exception.to.title !== "string"
    ) {
      continue;
    }
    const targetId = key(exception.to.file, exception.to.title);
    if (baseByKey.has(targetId)) {
      violations.push(
        `quarantine rename target already exists in the base: ${exception.to.file}: ${exception.to.title}`,
      );
    }
    if (newRenameTargetSources.has(targetId)) {
      violations.push(
        `multiple quarantine renames target the same identity: ${exception.to.file}: ${exception.to.title}`,
      );
    } else {
      newRenameTargetSources.set(
        targetId,
        key(exception.from?.file, exception.from?.title),
      );
    }
  }
  const exceptionFor = (predicate) => {
    const matches = exceptions
      .map((exception, index) => ({ exception, index }))
      .filter(
        ({ exception, index }) =>
          !historicalIndexes.has(index) && predicate(exception),
      );
    if (matches.length > 1) return { duplicate: true };
    return matches[0];
  };

  const newSuppressions = new Map();
  for (const item of baseSuppressed) {
    const id = key(item.file, item.title);
    const exactMatches = headByKey.get(id) ?? [];
    if (exactMatches.length > 1) {
      violations.push(`ambiguous head test identity: ${describe(item)}`);
      continue;
    }
    if (exactMatches.length === 1) {
      const current = exactMatches[0];
      if (!isSuppressed(current)) continue;
      if (suppressionIdentity(item) === suppressionIdentity(current)) continue;
      if (
        item.modifier === "fixme" &&
        ["skip", "fail", "only"].includes(current.modifier)
      ) {
        violations.push(
          `existing test.fixme was replaced by test.${current.modifier}: ${describe(item)}`,
        );
        continue;
      }
      if (["suite", "file", "focus"].includes(current.suppressionKind)) {
        violations.push(
          `suppressed test changed to broad ${current.suppressionKind} suppression: ${describe(item)}`,
        );
        continue;
      }
      if (["fail", "only"].includes(current.modifier)) {
        violations.push(
          `suppressed test was changed to test.${current.modifier}: ${describe(item)}`,
        );
        continue;
      }
      newSuppressions.set(id, current);
      continue;
    }

    const rename = exceptionFor(
      (exception) =>
        exception?.action === "rename" &&
        exception.from?.file === item.file &&
        exception.from?.title === item.title,
    );
    if (rename?.duplicate) {
      violations.push(
        `duplicate quarantine rename exception: ${describe(item)}`,
      );
      continue;
    }
    if (rename) {
      const { exception, index } = rename;
      used.add(index);
      if (
        !exceptionFieldsValid(exception, "rename") ||
        !exception.to ||
        typeof exception.to.file !== "string" ||
        typeof exception.to.title !== "string" ||
        headByKey.get(key(exception.to.file, exception.to.title))?.length !==
          1 ||
        (isSuppressed(
          headByKey.get(key(exception.to.file, exception.to.title))?.[0] ?? {},
        ) &&
          suppressionIdentity(item) !==
            suppressionIdentity(
              headByKey.get(key(exception.to.file, exception.to.title))?.[0] ??
                {},
            )) ||
        key(exception.to.file, exception.to.title) === id
      ) {
        violations.push(
          `invalid quarantine rename exception: ${describe(item)}`,
        );
      }
      continue;
    }

    const removal = exceptionFor(
      (exception) =>
        exception?.action === "remove" &&
        exception.file === item.file &&
        exception.title === item.title,
    );
    if (removal?.duplicate) {
      violations.push(
        `duplicate quarantine removal exception: ${describe(item)}`,
      );
      continue;
    }
    if (removal) {
      const { exception, index } = removal;
      used.add(index);
      if (!exceptionFieldsValid(exception, "remove")) {
        violations.push(
          `invalid quarantine removal exception: ${describe(item)}`,
        );
      }
      continue;
    }
    violations.push(
      `suppressed test disappeared without a removal or rename exception: ${describe(item)}`,
    );
  }

  for (const item of baseRegistrations) {
    if (item.modifier !== undefined || isSuppressed(item)) continue;
    const id = key(item.file, item.title);
    const current = headByKey.get(id) ?? [];
    if (current.length !== 1) continue;
    const currentItem = current[0];
    if (["fail", "only"].includes(currentItem.modifier)) {
      violations.push(
        `active test was changed to test.${currentItem.modifier}: ${describe(currentItem)}`,
      );
      continue;
    }
    if (["fixme", "skip"].includes(currentItem.modifier)) {
      newSuppressions.set(id, currentItem);
      continue;
    }
    if (["suite", "file", "focus"].includes(currentItem.suppressionKind)) {
      violations.push(
        `active test was suppressed by a broad ${currentItem.suppressionKind} modifier: ${describe(currentItem)}`,
      );
      continue;
    }
    if (isSuppressed(currentItem)) {
      newSuppressions.set(id, currentItem);
    }
  }
  for (const item of headRegistrations) {
    if (!["fixme", "skip"].includes(item.modifier)) continue;
    const id = key(item.file, item.title);
    if ((headByKey.get(id) ?? []).length > 1) {
      continue;
    }
    const baseItem = baseByKey.get(id);
    if (!baseItem || !isSuppressed(baseItem)) {
      newSuppressions.set(id, item);
      continue;
    }
    if (suppressionIdentity(baseItem) === suppressionIdentity(item)) continue;
    newSuppressions.set(id, item);
  }
  for (const item of headRegistrations) {
    if (!["fail", "only"].includes(item.modifier)) continue;
    const baseItem = baseByKey.get(key(item.file, item.title));
    if (baseItem?.modifier !== item.modifier) {
      violations.push(
        `new test.${item.modifier} declaration is not allowed: ${describe(item)}`,
      );
    }
  }
  for (const item of headRegistrations) {
    const id = key(item.file, item.title);
    if (baseByKey.has(id)) continue;
    if (item.modifier !== undefined || !isSuppressed(item)) continue;
    if (["suite", "file", "focus"].includes(item.suppressionKind)) {
      violations.push(
        `new test was suppressed by a broad ${item.suppressionKind} modifier: ${describe(item)}`,
      );
    } else {
      newSuppressions.set(id, item);
    }
  }

  for (const [id, item] of newSuppressions) {
    const addition = exceptionFor(
      (exception) =>
        exception?.action === "add" &&
        exception.file === item.file &&
        exception.title === item.title,
    );
    if (addition?.duplicate) {
      violations.push(
        `duplicate quarantine addition exception: ${describe(item)}`,
      );
      continue;
    }
    if (!addition) {
      violations.push(
        `new test suppression needs an explicit exception with reason, evidence, owner, and future expiry: ${describe(item)}`,
      );
      continue;
    }
    const { exception, index } = addition;
    used.add(index);
    if (
      !exceptionFieldsValid(exception, "add") ||
      typeof exception.owner !== "string" ||
      !exception.owner.trim() ||
      !validExpiry(exception.expires, today)
    ) {
      violations.push(
        `new suppression exception needs non-empty reason/evidence/owner and a future YYYY-MM-DD expiry: ${describe(item)}`,
      );
    }
  }

  for (const [index, exception] of exceptions.entries()) {
    const historical = historicalIndexes.has(index);
    const action = exception?.action;
    if (!exceptionFieldsValid(exception, action)) {
      violations.push(
        `invalid quarantine exception metadata at registry entry ${index + 1}`,
      );
      continue;
    }
    if (historical) {
      if (action === "add") {
        const current =
          headByKey.get(key(exception.file, exception.title)) ?? [];
        if (
          current.length === 1 &&
          isSuppressed(current[0]) &&
          (typeof exception.owner !== "string" ||
            !exception.owner.trim() ||
            !validExpiry(exception.expires, today))
        ) {
          violations.push(
            `active quarantine exception needs a non-empty owner and a future YYYY-MM-DD expiry: ${describe(current[0])}`,
          );
        }
      }
      continue;
    }

    if (action === "add" && !used.has(index)) {
      const current = headByKey.get(key(exception.file, exception.title)) ?? [];
      if (
        current.length === 1 &&
        isSuppressed(current[0]) &&
        (["fixme", "skip"].includes(current[0].modifier) ||
          current[0].suppressionKind === "runtime")
      ) {
        used.add(index);
        if (
          typeof exception.owner !== "string" ||
          !exception.owner.trim() ||
          !validExpiry(exception.expires, today)
        ) {
          violations.push(
            `quarantine exception needs non-empty reason/evidence/owner and a future YYYY-MM-DD expiry: ${describe(current[0])}`,
          );
        }
      }
    }
    if (!used.has(index)) {
      violations.push(
        `unused or invalid quarantine exception at registry entry ${index + 1}`,
      );
    }
  }
  return violations;
}

function readExceptions(cwd) {
  try {
    return parseQuarantineExceptions(
      readFileSync(path.join(cwd, EXCEPTIONS_PATH), "utf8"),
    );
  } catch (error) {
    failToRun(
      `${EXCEPTIONS_PATH} must contain a valid quarantine array: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseQuarantineExceptions(source) {
  const registry = JSON.parse(source);
  if (!registry || !Array.isArray(registry.quarantine)) {
    throw new Error("quarantine must be an array");
  }
  for (const [index, exception] of registry.quarantine.entries()) {
    if (!exception || typeof exception !== "object") {
      throw new Error(`quarantine entry ${index + 1} must be an object`);
    }
    if (!["add", "remove", "rename"].includes(exception.action)) {
      throw new Error(`quarantine entry ${index + 1} has an unknown action`);
    }
    if (
      typeof exception.reason !== "string" ||
      !exception.reason.trim() ||
      typeof exception.evidence !== "string" ||
      !exception.evidence.trim()
    ) {
      throw new Error(
        `quarantine entry ${index + 1} needs reason and evidence`,
      );
    }
    if (
      exception.action === "add" &&
      (typeof exception.file !== "string" ||
        !exception.file.trim() ||
        typeof exception.title !== "string" ||
        !exception.title.trim() ||
        typeof exception.owner !== "string" ||
        !exception.owner.trim() ||
        typeof exception.expires !== "string")
    ) {
      throw new Error(`quarantine addition ${index + 1} has invalid metadata`);
    }
    if (
      exception.action === "remove" &&
      (typeof exception.file !== "string" ||
        !exception.file.trim() ||
        typeof exception.title !== "string" ||
        !exception.title.trim())
    ) {
      throw new Error(`quarantine removal ${index + 1} has invalid identity`);
    }
    if (
      exception.action === "rename" &&
      (!exception.from ||
        typeof exception.from !== "object" ||
        typeof exception.from.file !== "string" ||
        !exception.from.file.trim() ||
        typeof exception.from.title !== "string" ||
        !exception.from.title.trim() ||
        !exception.to ||
        typeof exception.to !== "object" ||
        typeof exception.to.file !== "string" ||
        !exception.to.file.trim() ||
        typeof exception.to.title !== "string" ||
        !exception.to.title.trim())
    ) {
      throw new Error(`quarantine rename ${index + 1} has invalid identities`);
    }
  }
  return registry.quarantine;
}

export function readBaseExceptions(cwd, baseCommit) {
  try {
    const pathInTree = git(
      ["ls-tree", "-r", "--name-only", baseCommit, "--", EXCEPTIONS_PATH],
      cwd,
    ).trim();
    if (!pathInTree) return [];
    return parseQuarantineExceptions(
      git(["show", `${baseCommit}:${EXCEPTIONS_PATH}`], cwd),
    );
  } catch (error) {
    failToRun(
      `could not read valid ${EXCEPTIONS_PATH} at ${baseCommit}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function inspectCurrentFiles(cwd) {
  const files = listSpecFiles(path.join(cwd, E2E_DIR));
  let fixmeCount = 0;
  let skipCount = 0;
  const unexplained = [];
  for (const name of files) {
    const source = readFileSync(
      path.join(cwd, E2E_DIR, ...name.split("/")),
      "utf8",
    );
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (/test\.(?:describe\.)?skip\(/.test(line)) skipCount += 1;
      if (!/test\.(?:describe\.)?fixme\(/.test(line)) return;
      fixmeCount += 1;
      let cursor = index - 1;
      while (cursor >= 0 && lines[cursor].trim() === "") cursor -= 1;
      const above = cursor >= 0 ? lines[cursor].trim() : "";
      if (!above.startsWith("//") && !above.startsWith("*")) {
        unexplained.push(`${E2E_DIR}/${name}:${index + 1}`);
      }
    });
  }
  return { files, fixmeCount, skipCount, unexplained };
}

function main() {
  const listOnly = process.argv.includes("--list");
  try {
    const { files, fixmeCount, skipCount, unexplained } =
      inspectCurrentFiles(REPO_ROOT);
    const rows = [
      `${E2E_DIR}: ${fixmeCount}/${CEILINGS[E2E_DIR]} quarantined, ${skipCount}/${SKIP_CEILINGS[E2E_DIR]} conditional skips`,
    ];
    const failures = [];
    if (skipCount > SKIP_CEILINGS[E2E_DIR]) {
      failures.push(
        `  ${E2E_DIR}: ${skipCount} conditional test.skip sites exceeds its ceiling of ${SKIP_CEILINGS[E2E_DIR]}. A skip that fires every run is a park nobody counts — check it actually fires only when intended, or assert instead.`,
      );
    }
    if (fixmeCount > CEILINGS[E2E_DIR]) {
      failures.push(
        `  ${E2E_DIR}: ${fixmeCount} quarantined tests exceeds its ceiling of ${CEILINGS[E2E_DIR]} by ${fixmeCount - CEILINGS[E2E_DIR]}`,
      );
    }
    for (const where of unexplained) {
      failures.push(`  ${where}: test.fixme with no reason comment above it`);
    }
    if (listOnly) {
      console.log(rows.join("\n"));
      return;
    }

    const baseCommit = resolveQuarantineBaseCommit(REPO_ROOT);
    const base = readBaseRegistrations(REPO_ROOT, baseCommit);
    const head = readHeadRegistrations(REPO_ROOT);
    const baseExceptions = readBaseExceptions(REPO_ROOT, baseCommit);
    const quarantineViolations = compareQuarantineSnapshots(
      base,
      head,
      readExceptions(REPO_ROOT),
      undefined,
      baseExceptions,
    );
    failures.push(...quarantineViolations.map((item) => `  ${item}`));

    if (failures.length > 0) {
      console.error("guard:e2e-quarantine failed:\n");
      console.error(failures.join("\n"));
      console.error(
        `\nExact base suppressions are grandfathered until repaired. A new per-test suppression needs a matching entry in ${EXCEPTIONS_PATH} with reason, evidence, owner, and a future expiry. Deleting or renaming a quarantined test needs a matching remove or rename entry. Review exception evidence with the change.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`guard:e2e-quarantine: ${rows.join(", ")}.`);
  } catch (error) {
    const exitCode =
      error && typeof error === "object" && "exitCode" in error
        ? Number(error.exitCode)
        : 2;
    console.error(
      `guard:e2e-quarantine could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
