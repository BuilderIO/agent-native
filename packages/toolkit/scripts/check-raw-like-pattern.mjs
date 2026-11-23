#!/usr/bin/env node
// A search that builds its own SQL LIKE pattern matches the wrong rows: a reader who types `50%` or
// `a_b` gets rows that do not contain that text, because the wildcard is read as a wildcard. The shared
// rule already exists (`@agent-native/core/search-utils` exports likeContainsPattern / likeStartsWithPattern
// / likeEndsWithPattern and its spec pins `50%` -> `%50\%%`), so a hand-built pattern is a divergence, not
// a design choice. One app hit this class in six places (one of them escaped `%` and `_` but not a
// backslash), which is why the fleet checks it here rather than per lane.
//
// Usage: node packages/toolkit/scripts/check-raw-like-pattern.mjs [--root <repo>] [--json] [--warn]
//   --warn exits 0 while findings are printed: the shared boundary lands before every app has adopted it.
// Exit 0 clean (or --warn), 1 findings, 2 usage/scan error.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const repo =
  rootFlag >= 0 ? path.resolve(args[rootFlag + 1] ?? ".") : process.cwd();
const asJson = args.includes("--json");
const warnOnly = args.includes("--warn");

const TEMPLATES = path.join(repo, "templates");
if (!fs.existsSync(TEMPLATES)) {
  console.error(`no templates directory under ${repo}`);
  process.exit(2);
}

/** Strip line and block comments so a `%` inside prose never counts as a pattern. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead) => lead);
}

/** A placeholder inside a template literal that sits next to a LIKE wildcard. */
const HANDBUILT = [/%\$\{/, /\}%\s*$|\}%[`,)]/, /\$\{[^}]*\}%/];

/** A local copy of the escaping rule the shared module owns. */
const LOCAL_ESCAPER = /\.replace\(\s*\/\[\\\\?%_\]/;

function findIn(source) {
  const clean = stripComments(source);
  if (!/\bilike\b/i.test(clean) && !/\bLIKE\b/.test(clean)) return [];
  const hits = [];
  const lines = clean.split("\n");
  lines.forEach((line, index) => {
    if (HANDBUILT.some((rule) => rule.test(line))) {
      hits.push({
        line: index + 1,
        text: line.trim().slice(0, 120),
        kind: "hand-built-pattern",
      });
      return;
    }
    if (LOCAL_ESCAPER.test(line)) {
      hits.push({
        line: index + 1,
        text: line.trim().slice(0, 120),
        kind: "local-escaper",
      });
    }
  });
  return hits;
}

const findings = [];
for (const app of fs.readdirSync(TEMPLATES)) {
  const actionsDir = path.join(TEMPLATES, app, "actions");
  if (!fs.existsSync(actionsDir)) continue;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith(".ts") &&
        !/\.(spec|test)\.ts$/.test(entry.name)
      ) {
        const hits = findIn(fs.readFileSync(full, "utf8"));
        if (hits.length) {
          findings.push({
            app,
            file: path.relative(repo, full),
            hits,
          });
        }
      }
    }
  };
  walk(actionsDir);
}

if (asJson) {
  console.log(JSON.stringify({ findings }, null, 2));
} else {
  for (const finding of findings) {
    for (const hit of finding.hits) {
      console.log(`${finding.file}:${hit.line}  ${hit.kind}  ${hit.text}`);
    }
  }
  console.log(
    `${findings.length} actions file(s) build a LIKE pattern by hand instead of calling @agent-native/core/search-utils.`,
  );
}

if (findings.length === 0 || warnOnly) process.exit(0);
process.exit(1);
