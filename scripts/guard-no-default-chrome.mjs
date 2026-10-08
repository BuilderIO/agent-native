#!/usr/bin/env node
/**
 * Keep explanatory chrome off the default surface.
 *
 * "The UI has too much text" is the most repeated correction in this repo
 * (`text-heavy-ui` in scripts/agent-friction-report.mjs, 79 in the two weeks to
 * 2026-08-12 — the largest row in that table). Three prose rewrites of the same
 * rule failed to move it, so this is the mechanism half: the shapes below are
 * the ones the user has asked to have deleted by name, more than once.
 *
 * Scope note. This is a habit, not a backlog: the repo already renders hundreds
 * of legitimate muted paragraphs, and a guard that fails on all of them is a
 * guard someone turns off. So it checks only lines this branch ADDED. The tenth
 * instance cannot ship while the first nine stay a separate, schedulable
 * cleanup.
 *
 * What it deliberately cannot see: whether a sentence you wrote earns its place.
 * These four detectors cover structure only. The judgment half lives in
 * `.agents/skills/frontend-design` → Default Surface Density, and pretending
 * otherwise would make a green run read as "the surface is clean" when it only
 * means "no new instance of four known shapes".
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SOURCE_EXTENSIONS = /\.(tsx|jsx)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|\.react-router|\.generated|coverage)(\/|$)/;

const RULES = [
  {
    id: "required-prose-prop",
    pragma: "guard:allow-required-description",
    test: (line) =>
      /^\s*(eyebrow|kicker|description|subtitle|tagline|hint)\s*:\s*(string|ReactNode|React\.ReactNode)\s*;/.test(
        line,
      ),
    why: "Prose props must be optional. Write `description?: string`, and render nothing when it is absent.",
  },
  {
    id: "eyebrow",
    pragma: "guard:allow-eyebrow",
    multiline: true,
    re: /<(?:p|span|div)[^>]*className=\{?["'`][^"'`]*\buppercase\b[^"'`]*tracking-[^"'`]*text-muted-foreground[^"'`]*["'`][^>]*>[\s\S]{0,160}?<\/(?:p|span|div)>\s*<h[1-3]\b/g,
    why: "No eyebrow/kicker above a title. The nav rail and the route already say where the user is.",
  },
  {
    id: "empty-description-fallback",
    pragma: "guard:allow-empty-copy-fallback",
    test: (line) =>
      /\|\|\s*["'`][^"'`]{0,60}\b(no description|none yet|not set|no summary|nothing here)\b/i.test(
        line,
      ),
    why: 'An empty field renders nothing. Drop the `|| "No description yet."` fallback.',
  },
  {
    id: "card-title-blurb",
    pragma: "guard:allow-card-description",
    multiline: true,
    re: /<\/CardTitle>[\s\S]{0,240}?<p[^>]*className=\{?["'`][^"'`]*text-muted-foreground/g,
    anchorIn: (matched) => matched.lastIndexOf("<p"),
    why: "A card gets a title or a description, never both. Move the explanation to a tooltip or drop it.",
  },
];

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function relative(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-no-default-chrome");

  const violations = [];
  let filesChecked = 0;
  let linesChecked = 0;

  for (const [absolutePath, addedLineNumbers] of added) {
    const relativePath = relative(absolutePath);
    if (!SOURCE_EXTENSIONS.test(relativePath)) continue;
    if (EXCLUDED_PATH.test(relativePath)) continue;

    let source;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch {
      console.error(
        `guard-no-default-chrome: unreadable, skipped ${relativePath}`,
      );
      continue;
    }
    const lines = source.split("\n");
    filesChecked += 1;
    linesChecked += addedLineNumbers.size;

    for (const rule of RULES) {
      if (rule.multiline) {
        for (const match of source.matchAll(rule.re)) {
          const start = match.index ?? 0;
          const startLine = lineNumberAt(source, start);
          const anchorLine = lineNumberAt(
            source,
            start + (rule.anchorIn ? rule.anchorIn(match[0]) : 0),
          );
          const touched = [...addedLineNumbers].some(
            (n) =>
              n >= startLine &&
              n <= lineNumberAt(source, start + match[0].length),
          );
          if (!touched) continue;
          if (hasPragma(lines, anchorLine, rule.pragma)) continue;
          violations.push({
            file: relativePath,
            lineNumber: anchorLine,
            rule,
            snippet: (lines[anchorLine - 1] ?? "").trim(),
          });
        }
        continue;
      }

      for (const lineNumber of addedLineNumbers) {
        const line = lines[lineNumber - 1];
        if (line === undefined || !rule.test(line)) continue;
        if (hasPragma(lines, lineNumber, rule.pragma)) continue;
        violations.push({
          file: relativePath,
          lineNumber,
          rule,
          snippet: line.trim(),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `guard-no-default-chrome: OK (${linesChecked} added line(s) across ${filesChecked} file(s); no new default-surface chrome)`,
    );
    return;
  }

  console.error(
    `\nguard-no-default-chrome: ${violations.length} new instance(s) of chrome the user has repeatedly asked to remove.\n`,
  );
  const seen = new Set();
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.lineNumber}  ${violation.snippet}`,
    );
    if (!seen.has(violation.rule.id)) {
      seen.add(violation.rule.id);
      console.error(`      → ${violation.rule.why}`);
    }
  }
  console.error(
    "\nRead `.agents/skills/frontend-design` → Default Surface Density.\n" +
      "For a deliberate exception, put the matching pragma on the line above:\n" +
      RULES.map((rule) => `  ${rule.pragma} - short reason`).join("\n") +
      "\n",
  );
  process.exit(1);
}

function hasPragma(lines, lineNumber, pragma) {
  for (let offset = 2; offset <= 3; offset += 1) {
    if ((lines[lineNumber - offset] ?? "").includes(pragma)) return true;
  }
  return false;
}

main();
