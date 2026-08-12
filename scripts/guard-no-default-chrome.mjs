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

/**
 * `corpus` is intentionally NOT excluded: packages/core/corpus/templates/**
 * seeds new apps, so a shape that survives there ships to every app made later.
 */
const RULES = [
  {
    id: "required-prose-prop",
    // A component that types `description: string` cannot be rendered without
    // prose — tsc demands the sentence, and no skill rewrite reaches a type
    // error. Making it optional is the whole fix.
    pragma: "guard:allow-required-description",
    test: (line) =>
      /^\s*(eyebrow|kicker|description|subtitle|tagline|hint)\s*:\s*(string|ReactNode|React\.ReactNode)\s*;/.test(
        line,
      ),
    why: "Prose props must be optional. Write `description?: string`, and render nothing when it is absent.",
  },
  {
    id: "eyebrow",
    // The uppercase micro-label above a heading. It repeats the nav item that
    // is already on screen.
    pragma: "guard:allow-eyebrow",
    test: (line) =>
      /className=\{?["'`][^"'`]*\buppercase\b[^"'`]*\btracking-[^"'`]*\btext-muted-foreground/.test(
        line,
      ) ||
      /className=\{?["'`][^"'`]*\btext-muted-foreground[^"'`]*\buppercase\b/.test(
        line,
      ),
    why: "No eyebrow/kicker above a title. The nav rail and the route already say where the user is.",
  },
  {
    id: "empty-description-fallback",
    // "No description yet." is chrome wearing a data field's clothes: it turns
    // an empty column into a sentence on every row.
    pragma: "guard:allow-empty-copy-fallback",
    test: (line) =>
      /\|\|\s*["'`][^"'`]{0,60}\b(no description|none yet|not set|no summary|nothing here)\b/i.test(
        line,
      ),
    why: 'An empty field renders nothing. Drop the `|| "No description yet."` fallback.',
  },
  {
    id: "card-title-blurb",
    // A muted paragraph directly under a CardTitle — the hand-rolled
    // CardDescription. Guarding the component alone would inspect nothing,
    // because this is how it is actually written here.
    pragma: "guard:allow-card-description",
    multiline: true,
    re: /<\/CardTitle>[\s\S]{0,240}?<p[^>]*className=\{?["'`][^"'`]*text-muted-foreground/g,
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
      // A path in the diff that cannot be read is not a clean file. Say so
      // rather than counting it as checked.
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
          const lineNumber = lineNumberAt(source, match.index ?? 0);
          // Anchor on the muted <p>, which is the line the author added.
          const blurbOffset = (match.index ?? 0) + match[0].lastIndexOf("<p");
          const blurbLine = lineNumberAt(source, blurbOffset);
          if (
            !addedLineNumbers.has(blurbLine) &&
            !addedLineNumbers.has(lineNumber)
          )
            continue;
          if (hasPragma(lines, blurbLine, rule.pragma)) continue;
          violations.push({
            file: relativePath,
            lineNumber: blurbLine,
            rule,
            snippet: (lines[blurbLine - 1] ?? "").trim(),
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

/** A pragma on the line above, or the two above it for wrapped JSX. */
function hasPragma(lines, lineNumber, pragma) {
  for (let offset = 2; offset <= 3; offset += 1) {
    if ((lines[lineNumber - offset] ?? "").includes(pragma)) return true;
  }
  return false;
}

main();
