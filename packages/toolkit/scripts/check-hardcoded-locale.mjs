#!/usr/bin/env node
// Browser date and number formatting must use the reader's locale. A literal
// locale in `new Intl.DateTimeFormat("en-US", …)` or `toLocaleDateString("en-US")`
// pins every user to that locale, which is the "hardcoded locale and formats"
// QA class: dates read wrong for anyone outside it, whatever the app's locale
// setting says. This check is the shared boundary for that class so it is caught
// once for every template instead of app by app.
//
// Usage: node packages/toolkit/scripts/check-hardcoded-locale.mjs [--root <repo>] [--json] [--all] [--shared]
//   --shared also scans packages/toolkit/src (the components every template mounts), reported as app `@shared`.
// Exit 0 clean, 1 findings, 2 usage/scan error.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const repo =
  rootFlag >= 0 ? path.resolve(args[rootFlag + 1] ?? ".") : process.cwd();
const asJson = args.includes("--json");
const showAll = args.includes("--all");
const includeShared = args.includes("--shared");
const TEMPLATES = path.join(repo, "templates");
if (!fs.existsSync(TEMPLATES)) {
  console.error(`no templates directory under ${repo}`);
  process.exit(2);
}

// A locale literal is a language tag such as "en-US", "en-GB", "fr-FR".
const LOCALE = String.raw`["'](?:[a-z]{2})(?:[-_][A-Za-z]{2})["']`;
// Two halves of one class: a pinned literal ignores the reader's locale, and a
// missing argument silently falls back to the operating system's locale, which
// is just as wrong when the app's own locale setting says otherwise.
const PATTERNS = [
  {
    kind: "pinned-locale",
    re: new RegExp(
      String.raw`new\s+Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|Collator)\(\s*${LOCALE}`,
      "g",
    ),
  },
  {
    kind: "pinned-locale",
    re: new RegExp(
      String.raw`\.toLocale(?:Date|Time)?String\(\s*${LOCALE}`,
      "g",
    ),
  },
  { kind: "runtime-locale", re: /\.toLocale(?:Date|Time)?String\(\s*\)/g },
  {
    kind: "runtime-locale",
    re: /\.toLocale(?:Date|Time)?String\(\s*undefined/g,
  },
  {
    kind: "runtime-locale",
    re: /new\s+Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\(\s*\)/g,
  },
  {
    kind: "runtime-locale",
    re: /new\s+Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\(\s*undefined/g,
  },
];

/**
 * Comments are not code. A comment that names a pattern (the custom-emoji
 * settings explains the source's `toLocaleString()` call) was reported as a
 * finding and would have asked an app to change working code; strip them before
 * matching (2026-11-08).
 */
function withoutComments(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const findings = [];
const walk = (dir, app) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, app);
      continue;
    }
    if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
    if (/\.(spec|test)\./.test(entry.name)) continue;
    const source = withoutComments(fs.readFileSync(full, "utf8"));
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern.re)) {
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        findings.push({
          app,
          kind: pattern.kind,
          file: path.relative(repo, full),
          line,
          snippet: match[0].replace(/\s+/g, " ").slice(0, 100),
        });
      }
    }
  }
};

for (const app of fs.readdirSync(TEMPLATES)) {
  if (!app.endsWith("-2")) continue;
  const appDir = path.join(TEMPLATES, app, "app");
  if (fs.existsSync(appDir)) walk(appDir, app);
}

// The same class recurs in the shared Toolkit components every template mounts. They are scanned
// opt-in (`--shared`) so the default per-template run keeps its existing contract; `--shared`
// reports the shared sites under the synthetic app name `@shared` (2026-11-09 ARM C sibling sweep,
// where the class hit 15 templates plus 31 shared sites and the fix belonged at this boundary).
if (includeShared) {
  const sharedDir = path.join(repo, "packages", "toolkit", "src");
  if (fs.existsSync(sharedDir)) walk(sharedDir, "@shared");
}

if (asJson) {
  console.log(JSON.stringify({ findings }, null, 1));
} else {
  const byApp = new Map();
  for (const f of findings) byApp.set(f.app, (byApp.get(f.app) ?? 0) + 1);
  for (const [app, count] of [...byApp].sort((a, b) => b[1] - a[1]))
    console.log(`${app}: ${count}`);
  for (const f of showAll ? findings : findings.slice(0, 40))
    console.log(`${f.file}:${f.line}  ${f.snippet}`);
  console.log(
    findings.length === 0
      ? "clean: every browser format uses the reader's locale"
      : `${findings.length} hardcoded-locale format(s) across ${byApp.size} app(s); pass the reader's locale instead`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
