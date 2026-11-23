#!/usr/bin/env node
// Copy that tells a user something is "not available", "coming soon" or
// "unavailable" is a promise about a control that does not exist. When no code
// references such a string, it is the leftover of a removed or never-built
// control: dead copy that hides a gap instead of showing it. This check is the
// shared boundary for that class so it is caught once for every template.
//
// Usage: node packages/toolkit/scripts/check-dead-unavailable-copy.mjs [--root <repo>] [--json]
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

const PROMISE =
  /(not\s+available|coming\s+soon|unavailable|isn't\s+available|isn’t\s+available)/i;
const ENTRY = /^\s*([A-Za-z0-9_]+)\s*:\s*(["'`])((?:(?!\2).)*)\2\s*,?\s*$/;

const findings = [];
// Catalog and locale-data files define keys; they must never count as a
// reference or they would mask real dead copy.
const isCatalogFile = (file) =>
  /(^|\/)(default-messages|i18n-data)\.(ts|tsx|js|mjs)$/.test(file);
const readCode = (dir) => {
  let source = "";
  const walk = (root) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "i18n" ||
          entry.name === "dist"
        )
          continue;
        walk(full);
        continue;
      }
      if (
        !/\.(tsx|ts|jsx|js)$/.test(entry.name) ||
        /\.(spec|test)\./.test(entry.name)
      )
        continue;
      if (isCatalogFile(full)) continue;
      source += fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return source;
};
// A template renders shared package surfaces too, so a key referenced only
// from packages/<pkg>/src is live for every app that ships that surface.
// Scanning the package code once is what keeps this check from reporting a
// toolkit panel's own copy as an app's dead string.
const readSharedCode = (repo) => {
  const packagesDir = path.join(repo, "packages");
  if (!fs.existsSync(packagesDir)) return "";
  let source = "";
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const src = path.join(packagesDir, entry.name, "src");
    if (fs.existsSync(src)) source += readCode(src);
  }
  return source;
};
const sharedCode = readSharedCode(repo);

for (const app of fs.readdirSync(TEMPLATES)) {
  if (!app.endsWith("-2")) continue;
  const catalogPath = path.join(TEMPLATES, app, "app/i18n/en-US.ts");
  const appDir = path.join(TEMPLATES, app, "app");
  if (!fs.existsSync(catalogPath) || !fs.existsSync(appDir)) continue;
  const catalog = fs.readFileSync(catalogPath, "utf8");
  const code = readCode(appDir) + sharedCode;
  catalog.split("\n").forEach((line, index) => {
    const match = ENTRY.exec(line);
    if (!match) return;
    const [, key, , value] = match;
    if (!PROMISE.test(value)) return;
    // A key is referenced when any string literal in browser code ends with it.
    if (new RegExp(String.raw`["'\`][\w.]*\b${key}\b["'\`]`).test(code)) return;
    findings.push({
      app,
      file: path.relative(repo, catalogPath),
      line: index + 1,
      key,
      copy: value.slice(0, 120),
    });
  });
}

if (asJson) {
  console.log(JSON.stringify({ findings }, null, 1));
} else {
  const byApp = new Map();
  for (const f of findings) byApp.set(f.app, (byApp.get(f.app) ?? 0) + 1);
  for (const [app, count] of [...byApp].sort((a, b) => b[1] - a[1]))
    console.log(`${app}: ${count}`);
  for (const f of findings)
    console.log(`${f.file}:${f.line}  ${f.key} = ${f.copy}`);
  console.log(
    findings.length === 0
      ? "clean: no unused not-available copy"
      : `${findings.length} unused not-available string(s) across ${byApp.size} app(s) - each one is a control that was removed or never built`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
