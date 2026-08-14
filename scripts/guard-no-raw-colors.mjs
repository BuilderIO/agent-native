#!/usr/bin/env node
/**
 * guard-no-raw-colors.mjs
 *
 * Every template themes through HSL custom properties declared once in each
 * app's `app/global.css` (`--background`, `--foreground`, `--border`,
 * `--primary`, `--destructive`, `--muted-foreground`, etc.) and consumed via
 * `hsl(var(--x))` in CSS or `bg-background` / `text-foreground` / etc. in
 * Tailwind. A hardcoded hex/rgb/hsl literal or a literal-color Tailwind
 * utility (`bg-white`, `text-red-500`, ...) skips that layer, so it renders
 * wrong (or unreadable) the moment `.dark` is applied — and nothing short of
 * someone eyeballing dark mode ever catches it. That's exactly what kept
 * happening: "the red text we use for all this stuff is way too dark in dark
 * mode ... it's been whack-a-mole pointing it out over and over," plus a
 * design-app skeleton loader that hardcoded white. Both are one-line diffs
 * that a machine can catch at review time instead of the tenth time someone
 * screenshots dark mode.
 *
 * Scope: this guard only looks at lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) under templates/** and packages/**\/src/**
 * in .ts/.tsx/.css files — the repo already has thousands of pre-existing raw
 * colors and this is a habit to stop, not a backlog to clear in one pass.
 *
 * Flags:
 *   - raw hex colors: #rgb, #rrggbb, #rrggbbaa
 *   - literal rgb()/rgba()/hsl()/hsla() calls — i.e. NOT wrapping a token,
 *     so hsl(var(--foreground)) and rgba(var(--x), .5) are fine, but
 *     hsl(0 0% 50%) and rgba(0,0,0,.5) are not
 *   - the Tailwind literal-color utilities bg/text/border-white|black, and
 *     bg/text/border-(red|green|blue|gray|slate|zinc)-NN
 *
 * Excluded (raw values legitimately live here, or the file isn't reviewed
 * template/library UI code):
 *   - files named `global.css` — the per-app theme definition file where
 *     --background/--foreground/etc. are declared in the first place
 *   - *.stories.*, *.spec.*, *.test.*
 *   - any path with a `brand`, `tokens`, or `theme` directory segment
 *
 * Opt-out, for a genuine exception (e.g. a decorative gradient that
 * intentionally ignores the theme): put on the flagged line or the line
 * immediately above it:
 *
 *   // guard:allow-raw-color — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base can't be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED. A silent pass here would look identical
 * to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const IN_SCOPE_DIR = /^templates\//;
const IN_SCOPE_PKG_SRC = /^packages\/[^/]+\/src\//;
const IN_SCOPE_EXT = /\.(tsx|ts|css)$/;

const EXCLUDED_BUILD_DIR =
  /\/(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|\.react-router|\.generated|coverage)\//;
const EXCLUDED_TEST_FILE = /\.(stories|spec|test)\./;
const EXCLUDED_TOKEN_PATH = /(^|\/)(brand|tokens|theme)(\/|$)/i;
// `global.css` declares a running app's tokens; `templates-meta.ts` is the
// catalog where each template declares its own brand accent as data (all 17
// carry a hex plus its rgb triple). Both are definition sites — the raw value
// has to live somewhere, and flagging them sends an author looking for a token
// that by construction does not exist yet.
const THEME_DEFINITION_FILE =
  /(^|\/)(global\.css|packages\/core\/src\/cli\/templates-meta\.ts)$/;

/** Hex colors: #rgb, #rrggbb, #rrggbbaa (longest first so a #rrggbb inside a
 * longer hex run isn't mistaken for a #rgb prefix). */
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

/** rgb()/rgba()/hsl()/hsla() NOT wrapping a var() — hsl(var(--x)) and
 * rgba(var(--x), .5) are how the theme tokens are actually consumed. */
const COLOR_FUNC_RE = /\b(?:rgba?|hsla?)\(\s*(?!var\()/i;

const UTILITY_MONO_RE = /\b(bg|text|border)-(white|black)(?=[/\s"'`)]|$)/;
/** The same utility given an explicit `dark:` counterpart on the same line. */
const PAIRED_MONO_RE =
  /\bdark:(?:[\w-]+:)*(bg|text|border)-(white|black)(?=[/\s"'`)]|$)/;
const UTILITY_SHADE_RE =
  /\b(bg|text|border)-(red|green|blue|gray|slate|zinc)-(\d{2,3})(?=[/\s"'`)]|$)/;

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-raw-color\b/;

/** What real token in app/global.css to reach for instead of each literal
 * Tailwind color word — named explicitly so the failure message points
 * somewhere real, not just "use a variable". */
const TOKEN_HINT = {
  white:
    "background / card / popover (or primary-foreground on a colored surface)",
  black: "foreground (or primary on a light surface)",
  red: "destructive",
  green:
    "no success token exists yet — add one in app/global.css instead of hardcoding",
  blue: "no info/link token exists yet — add one in app/global.css instead of hardcoding, or primary if it's the brand color",
  gray: "muted-foreground (text) or border / muted (surfaces)",
  slate: "muted-foreground (text) or border / muted (surfaces)",
  zinc: "muted-foreground (text) or border / muted (surfaces)",
};

const HEX_HSL_HELP = `    Use the theme tokens declared in app/global.css instead:
      CSS:      hsl(var(--foreground)) / hsl(var(--background)) / hsl(var(--border)) /
                hsl(var(--destructive)) / hsl(var(--muted-foreground))
      Tailwind: bg-background, text-foreground, border-border, text-destructive,
                bg-muted, text-muted-foreground`;

function inScope(relPath) {
  if (EXCLUDED_BUILD_DIR.test(`/${relPath}`)) return false;
  if (!IN_SCOPE_EXT.test(relPath)) return false;
  if (!IN_SCOPE_DIR.test(relPath) && !IN_SCOPE_PKG_SRC.test(relPath)) {
    return false;
  }
  if (EXCLUDED_TEST_FILE.test(relPath)) return false;
  if (EXCLUDED_TOKEN_PATH.test(relPath)) return false;
  if (THEME_DEFINITION_FILE.test(relPath)) return false;
  return true;
}

/** Returns a violation descriptor for the line, or null if it's clean. */
function checkLine(lineText) {
  const hex = HEX_COLOR_RE.exec(lineText);
  if (hex) {
    return { snippet: hex[0], help: HEX_HSL_HELP };
  }
  const colorFunc = COLOR_FUNC_RE.exec(lineText);
  if (colorFunc) {
    return { snippet: colorFunc[0].trim(), help: HEX_HSL_HELP };
  }
  const mono = UTILITY_MONO_RE.exec(lineText);
  // `bg-black/5 dark:bg-white/10` is the theme layer, expressed inline: the
  // pair adapts in both directions, which is the property this guard exists to
  // protect. Flagging it named one instance of the rule (the literal word
  // "black") instead of the rule itself, and sent readers to replace working
  // code with a token that does not exist for scrim/overlay tints.
  if (mono && PAIRED_MONO_RE.test(lineText)) {
    return null;
  }
  if (mono) {
    const [snippet, , word] = mono;
    return {
      snippet,
      help: `    Replace with a semantic token: ${TOKEN_HINT[word]}.`,
    };
  }
  const shade = UTILITY_SHADE_RE.exec(lineText);
  if (shade) {
    const [snippet, , word] = shade;
    return {
      snippet,
      help: `    Replace with a semantic token: ${TOKEN_HINT[word]}.`,
    };
  }
  return null;
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-no-raw-colors");

  const violations = [];

  for (const [absFile, lineNumbers] of added) {
    const relPath = path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
    if (!inScope(relPath)) continue;

    let src;
    try {
      src = readFileSync(absFile, "utf8");
    } catch {
      continue; // file no longer present (renamed/deleted since diffing)
    }
    const lines = src.split("\n");

    for (const lineNumber of [...lineNumbers].sort((a, b) => a - b)) {
      const lineText = lines[lineNumber - 1];
      if (lineText === undefined) continue;

      const prevLine = lineNumber >= 2 ? lines[lineNumber - 2] : "";
      if (PRAGMA.test(lineText) || PRAGMA.test(prevLine)) continue;

      const violation = checkLine(lineText);
      if (!violation) continue;

      violations.push({
        relPath,
        lineNumber,
        text: lineText.trim(),
        ...violation,
      });
    }
  }

  if (violations.length === 0) {
    console.log("guard-no-raw-colors: OK");
    process.exit(0);
  }

  console.error(
    `\nguard-no-raw-colors: ${violations.length} raw color literal(s) added on this branch.\n`,
  );
  console.error(
    "A hardcoded color skips the light/dark theme layer and breaks the first\n" +
      "time someone switches modes. Use the HSL tokens from app/global.css.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.relPath}:${v.lineNumber}  ${v.text}`);
    console.error(`    found: ${v.snippet}`);
    console.error(v.help);
    console.error("");
  }
  console.error(
    "To opt out for a specific, reviewed exception add the comment:\n" +
      "  // guard:allow-raw-color — <reason>\n" +
      "on the same line or the line immediately above it.\n",
  );
  process.exit(1);
}

main();
