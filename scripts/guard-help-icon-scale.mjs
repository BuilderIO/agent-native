#!/usr/bin/env node
/**
 * Keep inline help glyphs visually subordinate to the text they explain.
 *
 * `IconHelpCircle` is often placed beside a small label, where a default
 * 16px icon makes the help affordance louder than the content. Inline help
 * glyphs should use `size-3` (12px) or smaller. Larger glyphs are still valid
 * for heading documentation controls and menu action icons, but those uses
 * must carry an explicit, reviewed pragma on the line immediately above them.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SOURCE_ROOTS = ["packages", "templates"];
const SOURCE_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|\.react-router|\.generated|coverage|corpus)(\/|$)/;
const HELP_ELEMENT_RE = /<Icon(?:HelpCircle|CircleHelp|Help)\b[\s\S]*?\/>/g;
const LOCAL_HELP_GLYPH_RE = /\.local-dev-help-glyph\s*\{[\s\S]*?\}/g;
const LARGE_GLYPH_RE =
  /(?:\b(?:size|h|w)-(?:3\.5|4|5|6|7|8)\b|\bsize\s*=\s*{?\s*(?:13|14|16|18|20|24|28|32)\s*}?)/;
const LARGE_CSS_GLYPH_RE =
  /(?:width|height):\s*(?:0\.75rem|1rem|1\.25rem|1\.5rem|2rem)/;
const ALLOW_PRAGMA = /guard:allow-large-help-icon\b/;

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(REPO_ROOT, absolutePath)
      .replaceAll("\\", "/");
    if (EXCLUDED_PATH.test(relativePath)) continue;
    if (entry.isDirectory()) {
      walk(absolutePath, files);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function main() {
  const violations = [];
  let checked = 0;

  for (const root of SOURCE_ROOTS) {
    const absoluteRoot = path.join(REPO_ROOT, root);
    for (const absolutePath of walk(absoluteRoot)) {
      const source = readFileSync(absolutePath, "utf8");
      const lines = source.split("\n");
      for (const match of source.matchAll(HELP_ELEMENT_RE)) {
        checked += 1;
        const element = match[0];
        if (!LARGE_GLYPH_RE.test(element)) continue;
        const lineNumber = lineNumberAt(source, match.index ?? 0);
        const previousLine = lines[lineNumber - 2] ?? "";
        if (ALLOW_PRAGMA.test(previousLine)) continue;
        violations.push({
          file: path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/"),
          lineNumber,
          element: element.replace(/\s+/g, " ").trim(),
        });
      }
      for (const match of source.matchAll(LOCAL_HELP_GLYPH_RE)) {
        checked += 1;
        if (!LARGE_CSS_GLYPH_RE.test(match[0])) continue;
        violations.push({
          file: path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/"),
          lineNumber: lineNumberAt(source, match.index ?? 0),
          element: match[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `guard-help-icon-scale: OK (${checked} help icon elements checked; inline glyphs are at most 12px)`,
    );
    return;
  }

  console.error(
    `\nguard-help-icon-scale: ${violations.length} oversized inline help glyph(s).\n`,
  );
  console.error(
    "Inline help glyphs should be `size-3` or smaller so the explanation stays primary.\n" +
      "Keep the trigger's hit area generous if needed, but shrink the glyph.\n",
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.lineNumber}  ${violation.element}`,
    );
  }
  console.error(
    "\nFor a deliberate heading or menu exception, add immediately above the icon:\n" +
      "  {/* guard:allow-large-help-icon - short reason */}\n",
  );
  process.exit(1);
}

main();
