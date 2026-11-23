#!/usr/bin/env node
// Opening a Dialog from inside a modal dropdown is a trap: both apply a body
// scroll lock, and the menu's lock is released when its exit animation ends, so
// closing the dialog can leave `pointer-events: none` on <body> - the page looks
// normal and every click does nothing. This app hit it in the agent builder's More
// actions menu and measured it (menu open: none, after Escape: auto, dialog open:
// none, after cancel: auto only once the dialog opens after the menu has closed).
//
// Two ways to be safe, and the check accepts either:
//   1. The app's Dialog comes from packages/toolkit, whose root restores a stale
//      body lock whenever a dialog closes, whichever order the locks unwind in
//      (measured: body auto after Cancel, click on the menu button works again).
//      With that in place a synchronous open is fine, and this is the preferred
//      fix because it repairs every caller at once.
//   2. Without it, an onSelect that opens a dialog must not open it
//      synchronously: defer it (setTimeout) so the dialog mounts after the menu
//      released its lock, and do not preventDefault the menu's close - that
//      keeps the menu (and its lock) alive underneath the dialog.
//
// Usage: node packages/toolkit/scripts/check-dialog-from-menu.mjs [--root <repo>] [--json]
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

// Is the toolkit's restoring Dialog the one these apps render?
const toolkitDialog = path.join(
  repo,
  "packages",
  "toolkit",
  "src",
  "ui",
  "dialog.tsx",
);
const toolkitRestores =
  fs.existsSync(toolkitDialog) &&
  /export function releaseStaleBodyLock/.test(
    fs.readFileSync(toolkitDialog, "utf8"),
  );

// The dialog module may be a local re-export or the toolkit import taken directly,
// so ask every file in the app rather than the conventional path only.
const appDialogUsesToolkit = (app) => {
  const own = path.join(
    TEMPLATES,
    app,
    "app",
    "components",
    "ui",
    "dialog.tsx",
  );
  if (
    fs.existsSync(own) &&
    /@agent-native\/toolkit\/ui\/dialog/.test(fs.readFileSync(own, "utf8"))
  ) {
    return true;
  }
  const appDir = path.join(TEMPLATES, app, "app");
  if (!fs.existsSync(appDir)) return false;
  const stack = [appDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
      if (
        /@agent-native\/toolkit\/ui\/dialog/.test(fs.readFileSync(full, "utf8"))
      ) {
        return true;
      }
    }
  }
  return false;
};

const findings = [];
const walk = (dir, app) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, app);
      continue;
    }
    if (!/\.tsx$/.test(entry.name) || /\.(spec|test)\./.test(entry.name))
      continue;
    const source = fs.readFileSync(full, "utf8");
    if (!/Dialog/.test(source) || !/DropdownMenuItem/.test(source)) continue;
    for (const match of source.matchAll(/onSelect=\{/g)) {
      // Read the onSelect body, balancing braces.
      let i = (match.index ?? 0) + "onSelect={".length;
      let depth = 1;
      const start = i;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        i += 1;
      }
      const body = source.slice(start, i - 1);
      const opensDialog =
        /set\w*Open\(true\)|set\w*Dialog\(true\)|setDialog\w*\(/.test(body);
      if (!opensDialog) continue;
      // A synchronous open is only a bug where the dialog that renders cannot
      // release the menu's stale body lock itself.
      if (toolkitRestores && appDialogUsesToolkit(app)) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const deferred =
        /setTimeout\(|requestAnimationFrame\(|queueMicrotask\(/.test(body);
      if (deferred) continue;
      findings.push({
        app,
        file: path.relative(repo, full),
        line,
        why: /preventDefault\(/.test(body)
          ? "opens a dialog synchronously and keeps the menu open (both body locks stay)"
          : "opens a dialog synchronously, before the menu releases its body lock",
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
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.why}`);
  console.log(
    findings.length === 0
      ? "clean: every dialog opened from a dropdown item releases the menu's stale body lock"
      : `${findings.length} menu item(s) across ${byApp.size} app(s) open a dialog that cannot release the menu's body lock - use the toolkit Dialog, or defer the open`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
