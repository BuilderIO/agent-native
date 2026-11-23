#!/usr/bin/env node
// A custom property that nothing defines is invisible until it matters. A rule
// that writes `var(--ws-danger, #e5484d)` keeps working in the light theme and
// goes illegible when the app's own dark tokens take over; a rule with no
// fallback at all (`font-size: var(--ws-small-label-size)`) is invalid at
// computed-value time, so the property silently reverts to its inherited value
// and the control renders at the wrong size on every theme.
//
// The rule: every custom property a stylesheet consumes is provided somewhere -
// declared by a stylesheet in the same app, or set at runtime by the app's own
// code (an inline `--name` style key or `setProperty("--name")`). Names set at
// runtime are legitimate and must be named here, so the next reader can see why
// the property has no theme declaration.
//
// Usage: node packages/toolkit/scripts/check-css-token-coverage.mjs [--root <repo>] [--json] [--shared]
//   --shared also scans packages/toolkit/src (the CSS every app mounts).
// Exit 0 clean, 1 findings, 2 usage/scan error.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const repo =
  rootFlag >= 0 ? path.resolve(args[rootFlag + 1] ?? ".") : process.cwd();
const asJson = args.includes("--json");
const withShared = args.includes("--shared");

const NAMESPACE = /^--(?:ws|an)-[a-z0-9-]+$/;
const CONSUMED = /var\(\s*(--[a-z0-9-]+)/g;
const DECLARED = /(?<![a-z0-9-])(--[a-z0-9-]+)\s*:/g;
// Runtime provision: a style object key (`"--x": value` / `"--x":` in JSX) or
// an explicit setProperty call. Both are read from the app's own source.
const RUNTIME_KEY = /["'](--[a-z0-9-]+)["']\s*:/g;
const RUNTIME_SET = /setProperty\(\s*["'](--[a-z0-9-]+)["']/g;

function walk(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist"
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function namesIn(source, pattern) {
  const out = new Set();
  for (const match of source.matchAll(pattern)) {
    if (NAMESPACE.test(match[1])) out.add(match[1]);
  }
  return out;
}

function scanTree(dir) {
  const consumed = new Map(); // name -> [file:line]
  const provided = new Set();
  walk(dir, (file) => {
    const ext = path.extname(file);
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(repo, file);
    if (ext === ".css") {
      for (const match of source.matchAll(CONSUMED)) {
        if (!NAMESPACE.test(match[1])) continue;
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        if (!consumed.has(match[1])) consumed.set(match[1], []);
        consumed.get(match[1]).push(`${rel}:${line}`);
      }
      for (const name of namesIn(source, DECLARED)) provided.add(name);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) {
      for (const name of namesIn(source, RUNTIME_KEY)) provided.add(name);
      for (const name of namesIn(source, RUNTIME_SET)) provided.add(name);
    }
  });
  return { consumed, provided };
}

const templates = path.join(repo, "templates");
if (!fs.existsSync(templates)) {
  console.error(`no templates directory under ${repo}`);
  process.exit(2);
}

const findings = [];
let appsScanned = 0;
const scanOne = (label, dir) => {
  const { consumed, provided } = scanTree(dir);
  appsScanned += 1;
  for (const [name, sites] of consumed) {
    if (provided.has(name)) continue;
    findings.push({ scope: label, variable: name, sites });
  }
};

for (const entry of fs.readdirSync(templates, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.endsWith("-2")) continue;
  const app = path.join(templates, entry.name, "app");
  if (fs.existsSync(app)) scanOne(entry.name, app);
}
if (withShared) scanOne("@shared", path.join(repo, "packages/toolkit/src"));

findings.sort(
  (a, b) =>
    a.scope.localeCompare(b.scope) || (a.variable < b.variable ? -1 : 1),
);

if (asJson) {
  console.log(
    JSON.stringify({ appsScanned, shared: withShared, findings }, null, 2),
  );
} else {
  console.log(
    `css token coverage: ${appsScanned} tree(s) scanned, ${findings.length} unprovided custom propert${findings.length === 1 ? "y" : "ies"}`,
  );
  for (const finding of findings) {
    console.log(`  ${finding.scope}: ${finding.variable}`);
    for (const site of finding.sites.slice(0, 6)) console.log(`    ${site}`);
    if (finding.sites.length > 6)
      console.log(`    ... ${finding.sites.length - 6} more`);
  }
}
process.exit(findings.length === 0 ? 0 : 1);
