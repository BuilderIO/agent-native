#!/usr/bin/env node
// A surface tone written as a literal hex in CSS is a tone for one appearance only.
// This app shipped starter pills at the dark reference's sampled #323232/#474747, so
// a light page rendered black pills with white text - two themes on one screen - and
// a fleet sweep found the same pattern in nine apps. The rule: a background, border or
// text colour in an app stylesheet resolves through a token, and the light block
// overrides the token, so one appearance can never inherit the other's surfaces.
//
// Usage: node packages/toolkit/scripts/check-surface-tone-literals.mjs [--root <repo>] [--json]
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

// A dark literal: the low-value hexes this class actually shows up as.
const LITERAL =
  /(?:^|[;{\s])(background-color|background|border-color|border|color)\s*:\s*(#[0-3][0-9a-fA-F]{5})(?![\w-])/g;

const findings = [];
const walk = (dir, app) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, app);
      continue;
    }
    if (!/\.css$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(LITERAL)) {
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      // A literal inside a :root variable block is the token definition itself.
      const before = source.slice(0, match.index ?? 0);
      const blockStart = before.lastIndexOf("{");
      const blockHeader = before.slice(
        before.lastIndexOf("}", blockStart) + 1,
        blockStart,
      );
      if (/^:root|^\s*:root\[|^html/.test(blockHeader.trim())) continue;
      findings.push({
        app,
        file: path.relative(repo, full),
        line,
        property: match[1],
        value: match[2],
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
  for (const f of findings)
    console.log(`${f.file}:${f.line}  ${f.property}: ${f.value}`);
  console.log(
    findings.length === 0
      ? "clean: surface tones resolve through tokens"
      : `${findings.length} surface tone(s) across ${byApp.size} app(s) are literal hex values - a light page keeps the dark tone; move each into a token with a light override`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
