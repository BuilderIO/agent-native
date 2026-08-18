#!/usr/bin/env node
/**
 * guard-no-secret-literals.mjs
 *
 * Background (2026-07): CLAUDE.md has always said "never hardcode API keys,
 * tokens, webhook URLs, signing secrets ... in source, docs, tests, fixtures,
 * screenshots, prompts" — but none of the guards actually checked for it. In
 * the last month a real Anthropic key and a full production Neon connection
 * string were pasted around in chat/PRs, and a live Neon database password
 * is sitting in plaintext right now inside this machine's
 * `.claude/settings.local.json` permission allow-list. A rule nobody
 * enforces is not a rule; this scans for the credential shapes that already
 * leaked so the same class of mistake gets caught before merge (or, for
 * local config, before anyone forgets it's there).
 *
 * Scope: every git-tracked file (`git ls-files` — ignored files, including
 * node_modules/dist/build, are already out of scope) plus any `.claude/*.json`
 * file that exists on disk. That second part is deliberate and NOT a bug:
 * `.claude/settings.local.json` is globally gitignored (never seen by CI on
 * a fresh checkout) but is exactly where the live Neon password above lives
 * today. If this guard reports a violation there, that is the guard working,
 * not a false positive to silence — go rotate the credential and scrub the
 * file instead of adding an opt-out.
 *
 * Opt-out (use sparingly, reviewers should push back on new ones):
 *
 *   // guard:allow-secret-literal — short reason
 *   # guard:allow-secret-literal — short reason
 *   <!-- guard:allow-secret-literal — short reason -->
 *
 * on the same line as the match or the line immediately above it.
 *
 * Output is redacted on purpose: this guard's own stdout lands in CI logs,
 * so a hit must never reprint the secret it found.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_PATH_SEGMENTS = new Set(["node_modules", "dist", "build", ".git"]);

const LOCK_FILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".rar",
  ".7z",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".class",
  ".jar",
  ".sqlite",
  ".sqlite3",
  ".pyc",
  ".node",
]);

// Above this size a "text" file is almost certainly a data dump, not source
// a human typed a secret into by hand; skip it rather than pay to scan it.
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** Line contains an obvious stand-in value rather than a real secret. */
const PLACEHOLDER_RE =
  /\bexample\b|\bplaceholder\b|\byour-|xxx|<|\bREPLACE\b|\bfake\b|\bdummy\b/i;

/** e.g. "xxxxxxxxxxxxxxxxxxxx" or "0000000000000000" used as a stand-in. */
const ALL_SAME_CHAR_RE = /(.)\1{7,}/;

const PRAGMA_RE = /(?:\/\/|#|<!--)\s*guard:allow-secret-literal\b/;

/**
 * Connection-string passwords used throughout docs/tests to illustrate the
 * URL shape (`postgres://user:pass@host`, `u:p@h`, `agent_native:change-me@`).
 * A real leaked password is never one of these literal words, so comparing
 * the captured password against this list (not the surrounding line, which
 * carries no other placeholder marker) is what keeps the guard quiet on
 * fixtures without weakening the check on an actual credential.
 */
const DB_PLACEHOLDER_PASSWORDS = new Set([
  "pass",
  "password",
  "p",
  "changeme",
  "change-me",
  "secret",
  "admin",
  "root",
  "test",
  "demo",
  "guest",
  "npg_pw",
  "pw",
  "dummy",
  "fake",
]);

/**
 * Each entry matches a credential shape and redacts its own match text.
 * `redact` only ever sees the matched substring (plus its own capture
 * groups), never surrounding line context, so it cannot accidentally echo
 * more of the secret than the pattern chose to capture. The optional
 * `isPlaceholder(m, index, contents)` hook filters shapes whose false
 * positives can't be told apart by the line-level checks alone.
 */
const PATTERNS = [
  {
    name: "Anthropic API key",
    re: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    redact: (m) => redactEdges(m, 7, 4),
  },
  {
    name: "generic sk- API key",
    re: /\bsk-[A-Za-z0-9]{32,}\b/g,
    redact: (m) => redactEdges(m, 5, 4),
  },
  {
    // Captures scheme/user/password separately so the password never
    // reaches the redaction preview, not even partially.
    name: "database connection string with password",
    re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^\s:@/]+):([^\s@/]+)@/g,
    redact: (_m, scheme, user) => `${scheme}://${user}:***@`,
    isPlaceholder: (m) =>
      DB_PLACEHOLDER_PASSWORDS.has((m[3] ?? "").toLowerCase()),
  },
  {
    name: "Neon API key",
    re: /\bnpg_[A-Za-z0-9]{12,}\b/g,
    redact: (m) => redactEdges(m, 4, 4),
  },
  {
    name: "GitHub token",
    re: /\bgh[poasru]_[A-Za-z0-9]{30,}\b/g,
    redact: (m) => redactEdges(m, 4, 4),
  },
  {
    name: "Slack token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    redact: (m) => redactEdges(m, 5, 4),
    // A real Slack token always carries numeric team/bot/install IDs in its
    // body; letters-and-hyphens-only strings here are test fixtures named
    // things like "xoxb-should-not-leak", not credential shapes.
    isPlaceholder: (m) => !/\d/.test(m[0]),
  },
  {
    name: "AWS access key id",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    redact: (m) => redactEdges(m, 6, 4),
  },
  {
    name: "Google API key",
    re: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    redact: (m) => redactEdges(m, 6, 4),
  },
  {
    name: "PEM private key",
    // Header only — the header line isn't the secret material, the body
    // that follows is, so there is nothing here that needs redacting.
    re: /-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----/g,
    redact: (m) => m,
    // A real key body is many lines of base64, at minimum tens of chars
    // even for the smallest key types. A one-line "-----BEGIN...\nx\n
    // -----END..." fixture (used to test parsing, not the key itself) has
    // no such body — that shape difference is the only reliable signal,
    // since the header text itself is identical for real and fake keys.
    isPlaceholder: (m, index, contents) => {
      const endIdx = contents.indexOf("-----END", index + m[0].length);
      if (endIdx === -1) return false; // no paired END nearby — don't guess, flag it
      const body = contents
        .slice(index + m[0].length, endIdx)
        .replace(/\s/g, "");
      return body.length < 40;
    },
  },
];

function redactEdges(match, headLen, tailLen) {
  if (match.length <= headLen + tailLen + 4) return "[REDACTED]";
  const hidden = match.length - headLen - tailLen;
  return `${match.slice(0, headLen)}…(${hidden} chars redacted)…${match.slice(-tailLen)}`;
}

function isSkippedPath(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => SKIP_PATH_SEGMENTS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (LOCK_FILE_NAMES.has(base)) return true;
  if (BINARY_EXTENSIONS.has(path.extname(base).toLowerCase())) return true;
  return false;
}

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").filter(Boolean);
}

/**
 * `.claude/settings.local.json` is globally gitignored, so `git ls-files`
 * never sees it — that's precisely where the credential that prompted this
 * guard was found. Scan top-level .claude/*.json on disk regardless of
 * tracked status; do not widen this to nested/worktree .claude dirs, those
 * are separate checkouts with their own lifecycle.
 */
function listLocalClaudeJsonFiles() {
  const dir = path.join(REPO_ROOT, ".claude");
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => `.claude/${e.name}`);
}

function lineNumberForOffset(contents, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (contents.charCodeAt(i) === 10) line++;
  }
  return line;
}

function hasOptOut(lines, lineIdx) {
  const cur = lines[lineIdx] ?? "";
  if (PRAGMA_RE.test(cur)) return true;
  const prev = lines[lineIdx - 1] ?? "";
  return PRAGMA_RE.test(prev);
}

function scanFile(rel) {
  const abs = path.join(REPO_ROOT, rel);
  let contents;
  try {
    contents = readFileSync(abs, "utf8");
  } catch {
    return []; // deleted/unreadable/symlink-to-nowhere — not this guard's job
  }
  if (contents.length > MAX_SCAN_BYTES) return [];

  const lines = contents.split("\n");
  const violations = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(contents)) !== null) {
      const lineIdx = lineNumberForOffset(contents, m.index) - 1;
      const lineText = lines[lineIdx] ?? "";

      if (PLACEHOLDER_RE.test(lineText)) continue;
      if (ALL_SAME_CHAR_RE.test(m[0])) continue;
      if (hasOptOut(lines, lineIdx)) continue;
      if (pattern.isPlaceholder?.(m, m.index, contents)) continue;

      violations.push({
        file: rel,
        line: lineIdx + 1,
        name: pattern.name,
        preview: pattern.redact(...m),
      });
    }
  }

  return violations;
}

function main() {
  const files = new Set(listTrackedFiles());
  for (const f of listLocalClaudeJsonFiles()) files.add(f);

  const violations = [];
  for (const rel of files) {
    if (isSkippedPath(rel)) continue;
    violations.push(...scanFile(rel));
  }

  if (violations.length === 0) {
    console.log("guard-no-secret-literals: OK");
    process.exit(0);
  }

  console.error(
    `\nguard-no-secret-literals: ${violations.length} credential-shaped literal(s) found.\n`,
  );
  console.error(
    "Never hardcode API keys, tokens, webhook URLs, signing secrets, or DB\n" +
      "passwords in source, docs, tests, fixtures, or config. Rotate the\n" +
      "credential and remove the literal (use a secrets manager / env var /\n" +
      "the vault instead), or if this is a genuine non-secret placeholder,\n" +
      "opt out with:\n" +
      "  // guard:allow-secret-literal — <reason>\n" +
      "on the same line or the line immediately above it.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.name}] ${v.preview}`);
  }
  console.error("");
  process.exit(1);
}

main();
