#!/usr/bin/env node
// A status colour is a measurement, not a guess. Every app replicates its own
// original, and the original's success and failure colours are its own muted
// values - picking a Tailwind palette shade instead is how one app shipped
// #49d47c where its reference measures #4aa44c, and a triangle where the
// reference draws a circle-x. The rule: a class that paints a success, failure,
// warning or running state resolves to a theme token, so the value has one
// place to be measured and changed. A deliberate brand hue on a status word
// stays, annotated with `status-color-ok: <reason>`.
//
// Usage: node packages/toolkit/scripts/check-status-color-tokens.mjs [--root <repo>] [--json]
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

// Tailwind palette hues that mean "state" when they land on a state word.
const HUE =
  /(?:^|[\s"':])(?:text|bg|border|fill|stroke|ring|from|to|via)-(?:emerald|green|lime|teal|rose|red|amber|yellow|orange)-\d{2,3}\b/g;
const STATE =
  /\b(success|succeeded|complete|completed|error|failed|failure|warning|warn|running|pending|positive|negative|healthy|unhealthy|connected|disconnected|online|offline|active|inactive|status|state|passed|passing|failing)\b/i;

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
    for (const match of source.matchAll(HUE)) {
      const at = match.index ?? 0;
      const line = source.slice(0, at).split("\n").length;
      // The tag this class sits in, plus the 240 characters before it: that is
      // where a component names the state it is rendering.
      const tagStart = source.lastIndexOf("<", at);
      const tag = source.slice(
        tagStart === -1 ? Math.max(0, at - 240) : tagStart,
        at + 240,
      );
      const before = source.slice(Math.max(0, at - 240), at);
      const named = STATE.test(tag) || STATE.test(before);
      if (!named) continue;
      if (/status-color-ok:/.test(before)) continue;
      findings.push({
        app,
        file: path.relative(repo, full),
        line,
        className: match[0].trim(),
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
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.className}`);
  console.log(
    findings.length === 0
      ? "clean: every state colour resolves to a theme token"
      : `${findings.length} state colour(s) on ${byApp.size} app(s) picked from a palette instead of a measured token - move the value into the app's theme, or annotate it with status-color-ok:`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
