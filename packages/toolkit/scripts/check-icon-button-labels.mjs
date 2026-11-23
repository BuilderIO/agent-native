#!/usr/bin/env node
// Icon-only buttons need an accessible name. A `size="icon"` button renders a
// glyph with no text, so without aria-label / aria-labelledby / title it reaches
// a screen reader (and a UI probe) as an unlabelled control. This check is the
// shared boundary for that class: it reads every template's browser code with
// the same rule, so the defect is caught once instead of app by app.
//
// Usage: node packages/toolkit/scripts/check-icon-button-labels.mjs [--root <repo>] [--json]
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

/**
 * Read one JSX opening tag, starting at `start` (the index of its `<`).
 *
 * A regex cannot do this correctly: `[^>]*?` stops at the first `>` and, since an
 * arrow function inside an attribute (`onClick={() => …}`) contains one, the match
 * ends in the middle of the tag and every attribute after it — including
 * `aria-label` — looks absent. Six of the ten sites this check reported on
 * 2026-11-08 were that false positive, across five apps, and the same tag can also
 * carry a `//` or `/* *\/` comment between attributes. The scan therefore tracks
 * brace depth, quotes and comments, so the tag ends at the `>` that closes it.
 */
export function readJsxTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    // A comment between attributes: skip to its end rather than mis-reading braces.
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end === -1) return source.slice(start);
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      if (end === -1) return source.slice(start);
      i = end + 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      continue;
    }
    if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/**
 * The attributes a screen reader can reach for an icon-only button. With `asChild`
 * the label lives on the child element the button renders as, so the child's own
 * opening tag counts too — the Content-2 media viewer and search rows were flagged
 * only because their `<a>`/`<Link>` child carries the `aria-label`.
 */
function accessibleNameText(source, tag, tagStart) {
  const own = tag;
  if (!/\basChild\b/.test(own)) return own;
  const afterTag = readJsxTag(source, tagStart + tag.length);
  void afterTag;
  // The child tag begins after this one; read the next element tag in the file.
  const nextTag = source.slice(tagStart + tag.length).search(/<[A-Za-z<]/);
  if (nextTag === -1) return own;
  const childStart = tagStart + tag.length + nextTag;
  const child = readJsxTag(source, childStart);
  return own + "\n" + child;
}

const TAG_START = /<(?:Button|button)\b/gs;
const findings = [];
const walk = (dir, app) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, app);
      continue;
    }
    if (!/\.(tsx|jsx)$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(TAG_START)) {
      const tag = readJsxTag(source, match.index ?? 0);
      if (!/\bsize="icon/.test(tag)) continue;
      if (
        /aria-label|aria-labelledby|\btitle=/.test(
          accessibleNameText(source, tag, match.index ?? 0),
        )
      )
        continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      findings.push({
        app,
        file: path.relative(repo, full),
        line,
        snippet: tag.replace(/\s+/g, " ").slice(0, 120),
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
      ? "clean: every icon-only button has an accessible name"
      : `${findings.length} icon-only button(s) across ${byApp.size} app(s) have no accessible name`,
  );
}
process.exit(findings.length === 0 ? 0 : 1);
