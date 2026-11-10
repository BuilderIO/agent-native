/**
 * guard-no-unsealed-secret-columns.ts
 *
 * A text column named like a secret (`api_key`, `access_token`, `password`)
 * holds whatever the writer puts in it, and the database cannot tell a sealed
 * value from a plaintext one. The Dispatch vault kept every provider key in a
 * plaintext `vault_secrets.value` beside an encrypted copy, so one SQL read
 * (a leaked connection string, a prompt-injected query) returned every key.
 *
 * Store credentials with `writeAppSecret` (`app_secrets`, AES-256-GCM) and keep
 * only a reference in your own table. If a table must hold the sealed value
 * itself, say so in the name — `encrypted_<name>`, `<name>_ciphertext`,
 * `<name>_hash` — and seal it with `encryptSecretValue`.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) for a new column in a Drizzle schema or SQL DDL
 * whose NAME carries a secret word and no sealed/derived marker. It reads names
 * only: a column called `value` that happens to hold a key is not caught, which
 * is why the rule above is about where credentials live, not about this check.
 *
 * A column that is genuinely not a stored credential (a public identifier, a
 * one-time code that expires in minutes) opts out on its line or the line above:
 *
 *   // guard:allow-plaintext-secret-column — <why this value is not a secret>
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look identical
 * to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-unsealed-secret-columns";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*|--)\s*guard:allow-plaintext-secret-column\b/;
const IN_SCOPE = /^(?:packages|templates|apps)\//;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|sql)$/;
const SKIPPED =
  /(\.spec\.|\.test\.|\.generated\.|\/__tests__\/|\/dist\/|\/node_modules\/|\/changelog\/|\/docs\/)/;

// Drizzle: `text("api_key")`, `varchar("api_key", { length: 255 })`.
const DRIZZLE_COLUMN =
  /\b(?:text|varchar|json|jsonb|bytea)\(\s*["'`]([A-Za-z0-9_]+)["'`]/g;
// DDL: `api_key TEXT`, `ADD COLUMN IF NOT EXISTS api_key TEXT`.
const DDL_COLUMN =
  /(?:^|\s|\()(?:ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(?:TEXT|VARCHAR(?:\(\d+\))?|JSONB?|BYTEA)\b/gi;

const SECRET_WORDS = new Set([
  "secret",
  "secrets",
  "token",
  "tokens",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "apikey",
]);
// The name already says the value is sealed, hashed, or only a preview of one.
const SEALED_WORDS = new Set([
  "encrypted",
  "ciphertext",
  "sealed",
  "hash",
  "hashed",
  "digest",
  "fingerprint",
  "salt",
  "last4",
  "preview",
  "hint",
  "prefix",
  "masked",
]);
// `token_type`, `secret_id`, `credential_ref`: metadata about a secret, not one.
const METADATA_LAST_WORDS = new Set([
  "id",
  "ids",
  "at",
  "in",
  "count",
  "type",
  "kind",
  "name",
  "names",
  "label",
  "status",
  "url",
  "uri",
  "scope",
  "scopes",
  "provider",
  "version",
  "policy",
  "enabled",
  "required",
  "ref",
  "refs",
  "expires",
  "expiry",
  "ttl",
]);

export interface UnsealedSecretColumnFinding {
  file: string;
  line: number;
  column: string;
}

export function isSourcePath(relPath: string): boolean {
  return (
    IN_SCOPE.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    !SKIPPED.test(relPath)
  );
}

export function isUnsealedSecretColumnName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words.join("_");
  const namesSecret =
    words.some((word) => SECRET_WORDS.has(word)) ||
    /(?:^|_)(?:api|private|access|signing|auth)_key(?:_|$)/.test(joined);
  if (!namesSecret) return false;
  if (words.some((word) => SEALED_WORDS.has(word))) return false;
  // `credential_key` names a credential (`OPENAI_API_KEY`); it is not one.
  if (/(?:^|_)credential_key$/.test(joined)) return false;
  return !METADATA_LAST_WORDS.has(words[words.length - 1] ?? "");
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

export function findUnsealedSecretColumns(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): UnsealedSecretColumnFinding[] {
  const lines = source.split(/\r?\n/);
  const findings: UnsealedSecretColumnFinding[] = [];
  const seen = new Set<string>();
  const optedOut = (lineNumber: number) =>
    PRAGMA.test(lines[lineNumber - 1] ?? "") ||
    PRAGMA.test(lines[lineNumber - 2] ?? "");
  const report = (line: number, column: string) => {
    if (seen.has(`${line}:${column}`) || !isUnsealedSecretColumnName(column)) {
      return;
    }
    seen.add(`${line}:${column}`);
    findings.push({ file, line, column });
  };

  // The formatter can wrap a definition right after `text(`, so Drizzle columns
  // are matched across the whole file and judged by both lines they span.
  for (const match of source.matchAll(DRIZZLE_COLUMN)) {
    const column = match[1];
    const startLine = lineAt(source, match.index);
    const nameLine = lineAt(
      source,
      match.index + match[0].length - column.length - 1,
    );
    if (!addedLines.has(startLine) && !addedLines.has(nameLine)) continue;
    if (optedOut(startLine) || optedOut(nameLine)) continue;
    report(nameLine, column);
  }

  for (const lineNumber of addedLines) {
    const text = lines[lineNumber - 1];
    if (text === undefined || optedOut(lineNumber)) continue;
    for (const match of text.matchAll(DDL_COLUMN)) report(lineNumber, match[1]);
  }
  return findings.sort((a, b) => a.line - b.line);
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: UnsealedSecretColumnFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isSourcePath(rel)) continue;

    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    inspected += 1;
    findings.push(...findUnsealedSecretColumns(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed source file(s) inspected)`,
    );
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} column(s) named like a secret and not marked sealed.`,
  );
  console.error(
    "\nA database column cannot tell a sealed value from a plaintext one, and a\n" +
      "single leaked read returns every row. Keep credentials in `app_secrets`:\n\n" +
      '  import { writeAppSecret, readAppSecret } from "@agent-native/core/secrets";\n\n' +
      "and store only the key name or a reference in your own table. If this\n" +
      "table must hold the sealed value itself, name it so — `encrypted_<name>`,\n" +
      "`<name>_ciphertext`, `<name>_hash` — and seal it with `encryptSecretValue`.\n",
  );
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line} — column "${finding.column}"`,
    );
  }
  console.error(
    "\nIf the value is not a stored credential (a public identifier, a short-lived\n" +
      "one-time code), say why on the line or the line above:\n" +
      "  // guard:allow-plaintext-secret-column — <why>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
