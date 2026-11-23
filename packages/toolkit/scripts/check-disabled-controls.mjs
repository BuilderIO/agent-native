#!/usr/bin/env node
// A control that is permanently disabled is a promise the product cannot keep:
// the reference shows the surface, ours shows a control that never works. The
// fleet's remedy is to back it, remove it, or annotate it as a tracked
// placeholder with a `placeholder-row: <row> owner=<lane>` comment. This check
// is the shared boundary for that class: one rule over every template.
//
// Usage: node packages/toolkit/scripts/check-disabled-controls.mjs [--root <repo>] [--json]
// Exit 0 clean, 1 findings, 2 usage/scan error.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const repo =
  rootFlag >= 0 ? path.resolve(args[rootFlag + 1] ?? ".") : process.cwd();
const asJson = args.includes("--json");
const TEMPLATES = path.join(repo, "templates");
if (!fs.existsSync(TEMPLATES)) {
  console.error(`no templates directory under ${repo}`);
  process.exit(2);
}

/** Read one JSX tag from `start`, balancing quotes and JSX braces before '>'. */
function readTag(source, start) {
  let i = start;
  let quote = null;
  let braces = 0;
  while (i < source.length) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === ">" && braces === 0) break;
    i += 1;
  }
  return source.slice(start, i + 1);
}

/**
 * Drop the comments inside a tag before reading its attributes. A tag that
 * mentions the word in a comment ("never left disabled with no way back") is
 * not a disabled control: that reading cost two content-2 rows their first
 * verdict and would have asked an app to remove a working Remove filter button
 * (2026-11-08).
 */
function withoutComments(tag) {
  return tag
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
    if (!/\.(tsx|jsx)$/.test(entry.name) || /\.(spec|test)\./.test(entry.name))
      continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(/<[Bb]utton\b/g)) {
      const tag = readTag(source, match.index ?? 0);
      const attributes = withoutComments(tag);
      if (!/\bdisabled\b/.test(attributes)) continue;
      // A conditional disable is fine: it reflects state.
      if (/disabled=\{(?!\s*true\s*\})/.test(attributes)) continue;
      // A spread can carry `disabled` from its caller, so the element is not
      // permanently disabled here; its callers are read at their own sites.
      if (/\{\s*\.\.\./.test(attributes)) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const context = source.slice(
        Math.max(0, (match.index ?? 0) - 400),
        match.index ?? 0,
      );
      if (/placeholder-row:/.test(context)) continue;
      findings.push({
        app,
        file: path.relative(repo, full),
        line,
        snippet: tag.replace(/\s+/g, " ").slice(0, 110),
      });
    }
  }
};

for (const app of fs.readdirSync(TEMPLATES)) {
  if (!app.endsWith("-2")) continue;
  const appDir = path.join(TEMPLATES, app, "app");
  if (fs.existsSync(appDir)) walk(appDir, app);
}

if (asJson) {
  console.log(JSON.stringify({ findings }, null, 1));
} else {
  const byApp = new Map();
  for (const f of findings) byApp.set(f.app, (byApp.get(f.app) ?? 0) + 1);
  for (const [app, count] of [...byApp].sort((a, b) => b[1] - a[1]))
    console.log(`${app}: ${count}`);
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.snippet}`);
  console.log(
    findings.length === 0
      ? "clean: no permanently disabled control without a tracked placeholder row"
      : `${findings.length} permanently disabled control(s) across ${byApp.size} app(s) - back it, remove it, or annotate it with placeholder-row:`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
