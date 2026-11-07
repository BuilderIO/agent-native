#!/usr/bin/env node
/**
 * Keep new dialogs and menus on the house block recipes.
 *
 * `.agents/skills/shadcn-ui/references/blocks.md` carries the recipes. These
 * shapes are the ones agents keep shipping anyway: on 2026-11-06, 63 files put
 * decorative icons on menu items and 62 hand-styled `AlertDialogAction` with
 * `bg-destructive` while it already accepts `variant="destructive"`. Prose
 * alone did not hold, so this checks only lines the branch adds; the existing
 * backlog stays a separate cleanup.
 *
 * What it cannot see: whether a row with `…` really opens a dialog, or whether
 * a red item really destroys something. Those stay with the skill.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SCOPED_PATH =
  /^(templates\/|community-templates\/|packages\/[^/]+\/src\/)/;
const SOURCE_EXTENSIONS = /\.(tsx|ts)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.react-router|\.generated|coverage|__fixtures__)(\/|$)|\.(test|spec|stories)\.[jt]sx?$/;
const CATALOG_PATH = /\/i18n\/[a-z]{2}(?:-[A-Z]{2})?\.ts$/;

// The prompt composer's `+` menu: its icons identify the kind of content being
// added, so they are content, not decoration.
const MENU_ICON_ALLOWED_PATHS = new Set([
  "packages/toolkit/src/composer/ComposerContextMenu.tsx",
]);

// One JSX attribute value: a quoted string or a `{…}` expression with up to
// two levels of nested braces, so `onSelect={() => …}` doesn't end the tag.
const JSX_ATTRS = String.raw`(?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*`;

export type UiBlocksRuleId =
  | "menu-leading-icon"
  | "three-dot-ellipsis"
  | "title-ellipsis"
  | "hand-rolled-destructive";

interface Rule {
  id: UiBlocksRuleId;
  pragma: string;
  why: string;
  applies: (file: string) => boolean;
  /** Returns 0-based character offsets of each violation in the source. */
  find: (source: string) => number[];
}

function offsets(
  source: string,
  re: RegExp,
  anchor?: (m: RegExpMatchArray) => number,
) {
  const found: number[] = [];
  for (const match of source.matchAll(re)) {
    found.push((match.index ?? 0) + (anchor ? anchor(match) : 0));
  }
  return found;
}

const MENU_ITEM_WITH_LEADING_ICON = new RegExp(
  String.raw`<(?:DropdownMenu|ContextMenu|Menubar)(?:Item|CheckboxItem|RadioItem|SubTrigger)\b${JSX_ATTRS}>\s*(<Icon[A-Z]\w*)`,
  "g",
);
const BUTTON_OPENING_TAG = new RegExp(
  String.raw`<(?:AlertDialogAction|Button)\b${JSX_ATTRS}>`,
  "g",
);

export const RULES: readonly Rule[] = [
  {
    id: "menu-leading-icon",
    pragma: "guard:allow-menu-content-glyph",
    why: "Menus are text only. Drop the leading icon; keep checks, chevrons, shortcuts, and glyphs that are the content (swatches, avatars).",
    applies: (file) =>
      file.endsWith(".tsx") && !MENU_ICON_ALLOWED_PATHS.has(file),
    find: (source) =>
      offsets(source, MENU_ITEM_WITH_LEADING_ICON, (m) =>
        m[0].lastIndexOf(m[1] ?? "<Icon"),
      ),
  },
  {
    id: "three-dot-ellipsis",
    pragma: "guard:allow-three-dots",
    why: "Use the ellipsis character `…`, not three periods.",
    applies: (file) => CATALOG_PATH.test(file) || file.endsWith(".tsx"),
    find: (source) => [
      // A string literal value whose text contains `...` (not a spread).
      ...offsets(source, /(?<=["'`])[^"'`\n]*?\w\.\.\.(?=[^"'`\n]*["'`])/g),
      // JSX text such as `>Loading...<`.
      ...offsets(source, />[^<>{}\n]*\w\.\.\.\s*</g),
    ],
  },
  {
    id: "title-ellipsis",
    pragma: "guard:allow-title-ellipsis",
    why: "Titles never end in `…`. Keep the ellipsis on the menu item that opens the dialog, not on the dialog's title.",
    applies: (file) => CATALOG_PATH.test(file) || file.endsWith(".tsx"),
    find: (source) => [
      ...offsets(
        source,
        /^\s*\w*[Tt]itle\s*:\s*["'`][^"'`\n]*[^\s"'`](?:…|\.\.\.)["'`]/gm,
      ),
      ...offsets(
        source,
        /<(?:Dialog|AlertDialog|Sheet|Drawer)Title\b[^>]*>[^<{]*(?:…|\.\.\.)\s*</g,
      ),
    ],
  },
  {
    id: "hand-rolled-destructive",
    pragma: "guard:allow-destructive-class",
    why: 'Use `variant="destructive"` on the Button or AlertDialogAction instead of hand-styled `bg-destructive` classes.',
    applies: (file) => file.endsWith(".tsx"),
    find: (source) => {
      const found: number[] = [];
      for (const match of source.matchAll(BUTTON_OPENING_TAG)) {
        const at = match[0].search(/(?<![\w:/-])bg-destructive\b/);
        if (at >= 0) found.push((match.index ?? 0) + at);
      }
      return found;
    },
  },
];

export interface UiBlocksFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  source: string;
  /** 1-based line numbers this branch added; omit to check every line. */
  addedLines?: ReadonlySet<number>;
}

export interface UiBlocksViolation {
  file: string;
  line: number;
  rule: UiBlocksRuleId;
  snippet: string;
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function hasPragma(lines: readonly string[], line: number, pragma: string) {
  for (let back = 0; back <= 2; back += 1) {
    if ((lines[line - 1 - back] ?? "").includes(pragma)) return true;
  }
  return false;
}

export function findUiBlocksViolations(
  files: readonly UiBlocksFile[],
): UiBlocksViolation[] {
  const violations: UiBlocksViolation[] = [];
  for (const file of files) {
    const lines = file.source.split("\n");
    for (const rule of RULES) {
      if (!rule.applies(file.path)) continue;
      const seen = new Set<number>();
      for (const offset of rule.find(file.source)) {
        const line = lineNumberAt(file.source, offset);
        if (seen.has(line)) continue;
        seen.add(line);
        if (file.addedLines && !file.addedLines.has(line)) continue;
        if (hasPragma(lines, line, rule.pragma)) continue;
        violations.push({
          file: file.path,
          line,
          rule: rule.id,
          snippet: (lines[line - 1] ?? "").trim(),
        });
      }
    }
  }
  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

export function isGuardedPath(relativePath: string): boolean {
  return (
    SCOPED_PATH.test(relativePath) &&
    SOURCE_EXTENSIONS.test(relativePath) &&
    !EXCLUDED_PATH.test(relativePath)
  );
}

export function main(): void {
  const added = requireAddedLines(REPO_ROOT, "guard:ui-blocks");
  const files: UiBlocksFile[] = [];
  for (const [absolutePath, addedLines] of added) {
    const relativePath = path
      .relative(REPO_ROOT, absolutePath)
      .replaceAll("\\", "/");
    if (!isGuardedPath(relativePath)) continue;
    let source: string;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      console.error(
        `guard:ui-blocks: could not read ${relativePath}: ${String(error)}`,
      );
      process.exit(1);
    }
    files.push({ path: relativePath, source, addedLines });
  }

  const violations = findUiBlocksViolations(files);
  if (violations.length === 0) {
    console.log(
      `guard:ui-blocks: OK (${files.length} changed file(s), no new off-recipe dialog or menu shapes)`,
    );
    return;
  }

  console.error(
    `\nguard:ui-blocks: ${violations.length} new instance(s) on lines this branch added.\n`,
  );
  const explained = new Set<UiBlocksRuleId>();
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.snippet}`,
    );
    if (!explained.has(violation.rule)) {
      explained.add(violation.rule);
      const rule = RULES.find((candidate) => candidate.id === violation.rule);
      console.error(`      → [${violation.rule}] ${rule?.why ?? ""}`);
    }
  }
  console.error(
    "\nRecipes: `.agents/skills/shadcn-ui/references/blocks.md`.\n" +
      "For a reviewed exception, put the rule's pragma and a reason on the line or up to two lines above:\n" +
      RULES.map((rule) => `  // ${rule.pragma} - short reason`).join("\n") +
      "\n",
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
