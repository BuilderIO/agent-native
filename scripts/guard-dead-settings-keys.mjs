#!/usr/bin/env node
/**
 * guard-dead-settings-keys.mjs
 *
 * A settings toggle is a promise: flip it and the app behaves differently.
 * The failure this guard exists for is the toggle that persists a value
 * nothing ever reads. Clips shipped an "Email notifications" switch whose key
 * was only ever written, and Brain still carries two of them
 * (`autoArchiveResolved`, `notifyOnSourceErrors`). Nothing errors; the user
 * simply believes something is configured that is not. That is
 * indistinguishable from working software until someone goes looking.
 *
 * Every persisted preference key a template declares must have at least one
 * reader OUTSIDE the places that merely declare, display, translate, or save
 * it.
 *
 * Declaration sites scanned per template:
 *   - `actions/set-settings.ts` top-level zod schema keys
 *   - `shared/*-prefs.ts` exported preference type fields
 *
 * Occurrences that do NOT count as a reader:
 *   - the declaring file itself
 *   - settings UI (app/routes/*settings*, app/pages/*Settings*)
 *   - i18n catalogs (app/i18n*)
 *   - the generic user-prefs HTTP routes, which pass the whole blob through
 *   - tests and specs
 *
 * Opt-out for a key that is intentionally forward-declared, or read somewhere
 * this heuristic cannot see. Put on the declaration line or the line above:
 *
 *   // settings-key-unused-ok - short reason
 *
 * Reviewed exceptions live in KNOWN_DEAD_KEYS below so they stay a visible
 * decision rather than a silent one.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Dead keys we are knowingly carrying. Each entry is a decision to revisit:
 * wire it up or delete it, but not silently.
 */
const KNOWN_DEAD_KEYS = [
  {
    template: "brain",
    key: "autoArchiveResolved",
    reason:
      "Persisted and shown in Settings but never read; kept pending review archival.",
  },
  {
    template: "brain",
    key: "notifyOnSourceErrors",
    reason:
      "Persisted and shown in Settings but never read; kept pending source-error notifications.",
  },
];

const OPT_OUT = /settings-key-unused-ok/;

function templates() {
  const dir = path.join(REPO_ROOT, "templates");
  return readdirSync(dir).filter((name) =>
    existsSync(path.join(dir, name, "package.json")),
  );
}

/** Top-level `key: z....` entries in the set-settings zod schema. */
function zodSchemaKeys(source) {
  const start = source.indexOf("schema: z.object({");
  if (start === -1) return [];
  const lines = source.slice(start).split("\n");
  const keys = [];
  let depth = 0;
  let baseline = null;
  for (const [index, line] of lines.entries()) {
    const before = depth;
    depth += (line.match(/[({[]/g) ?? []).length;
    depth -= (line.match(/[)}\]]/g) ?? []).length;
    if (index === 0) {
      baseline = depth;
      continue;
    }
    // A key is top-level only when the line starts at the schema's own depth.
    if (before === baseline) {
      const match = line.match(/^ {4}([A-Za-z_]\w*)\s*:/);
      if (match) keys.push({ key: match[1], line });
    }
    if (depth < baseline) break;
  }
  return keys;
}

/** Field names inside an exported preferences type alias. */
function prefsTypeKeys(source) {
  const block = source.match(
    /export type \w*Prefs\w* = [^;]*?\{([\s\S]*?)\n\};/,
  );
  if (!block) return [];
  const keys = [];
  for (const line of block[1].split("\n")) {
    const match = line.match(/^ {2}([A-Za-z_]\w*)\??\s*:/);
    if (match) keys.push({ key: match[1], line });
  }
  return keys;
}

function declarationFiles(template) {
  const root = path.join(REPO_ROOT, "templates", template);
  const files = [];

  const setSettings = path.join(root, "actions/set-settings.ts");
  if (existsSync(setSettings)) files.push({ file: setSettings, kind: "zod" });

  const sharedDir = path.join(root, "shared");
  if (existsSync(sharedDir)) {
    for (const name of readdirSync(sharedDir)) {
      if (/-prefs\.ts$/.test(name)) {
        files.push({ file: path.join(sharedDir, name), kind: "type" });
      }
    }
  }
  return files;
}

function isReaderPath(rel) {
  if (/\.(spec|test)\.tsx?$/.test(rel)) return false;
  if (rel.startsWith("app/i18n")) return false;
  if (/^app\/routes\/.*settings.*\.tsx?$/i.test(rel)) return false;
  if (/^app\/pages\/.*settings.*\.tsx?$/i.test(rel)) return false;
  if (/user-prefs\.(get|put)\.ts$/.test(rel)) return false;
  return true;
}

function hasReader(template, key, declaringFile) {
  const root = path.join(REPO_ROOT, "templates", template);
  let output = "";
  try {
    output = execFileSync(
      "grep",
      [
        "-rl",
        "--include=*.ts",
        "--include=*.tsx",
        "--exclude-dir=node_modules",
        "--exclude-dir=dist",
        "--exclude-dir=.output",
        "--",
        key,
        root,
      ],
      { encoding: "utf8" },
    );
  } catch {
    // grep exits 1 when nothing matches at all.
    return false;
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some(
      (file) =>
        path.resolve(file) !== path.resolve(declaringFile) &&
        isReaderPath(path.relative(root, file)),
    );
}

const failures = [];
const knownSeen = new Set();

for (const template of templates()) {
  for (const { file, kind } of declarationFiles(template)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    const keys = kind === "zod" ? zodSchemaKeys(source) : prefsTypeKeys(source);

    for (const { key, line } of keys) {
      const index = lines.indexOf(line);
      const previous = index > 0 ? lines[index - 1] : "";
      if (OPT_OUT.test(line) || OPT_OUT.test(previous)) continue;

      if (
        KNOWN_DEAD_KEYS.some(
          (entry) => entry.template === template && entry.key === key,
        )
      ) {
        knownSeen.add(`${template}.${key}`);
        continue;
      }

      if (!hasReader(template, key, file)) {
        failures.push({ template, key, file: path.relative(REPO_ROOT, file) });
      }
    }
  }
}

const staleKnown = KNOWN_DEAD_KEYS.filter(
  (entry) => !knownSeen.has(`${entry.template}.${entry.key}`),
);

if (failures.length === 0 && staleKnown.length === 0) {
  console.log("guard-dead-settings-keys: OK");
  process.exit(0);
}

if (failures.length > 0) {
  console.error(
    `guard-dead-settings-keys: ${failures.length} persisted settings key(s) with no reader.`,
  );
  console.error(
    "A key that is only written and displayed is a promise the app does not keep.",
  );
  console.error("Wire it up, delete it, or record the exception.\n");
  for (const failure of failures) {
    console.error(`  ${failure.template}: ${failure.key}  (${failure.file})`);
  }
  console.error(
    "\nTo opt out for a reviewed exception, put this on the declaration line or the line above:",
  );
  console.error("  // settings-key-unused-ok - <reason>");
}

if (staleKnown.length > 0) {
  console.error(
    "\nguard-dead-settings-keys: KNOWN_DEAD_KEYS entries no longer match a declared key.",
  );
  console.error("Remove them so the list keeps meaning something:");
  for (const entry of staleKnown) {
    console.error(`  ${entry.template}: ${entry.key}`);
  }
}

process.exit(1);
