#!/usr/bin/env node
/**
 * Keep every search field to exactly one clear affordance.
 *
 * WebKit paints `::-webkit-search-cancel-button` inside every
 * `input[type="search"]`. A field that also renders its own clear button shows
 * two "x" controls side by side — reported three times across Calendar and
 * Chat before it was traced to the shared settings component.
 *
 * The stylesheet suppresses the platform widget only for fields carrying
 * `agent-native-search-input`, because a field with no clear button of its own
 * still needs it. That makes the pairing the invariant worth checking: a
 * search input whose wrapper renders a clear button must carry the class, and
 * a field carrying the class must actually render one.
 *
 * Known boundary: a field whose type is a variable (`type={inputType}`) is
 * invisible to a text scan. That is a deliberate limit, not an oversight - the
 * alternative is rendering every candidate, and the failure mode is only the
 * pre-existing duplicate rather than a new defect. Every literal spelling that
 * survives `oxfmt` is covered.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SOURCE_ROOTS = ["packages", "templates"];
const SOURCE_EXTENSIONS = /\.(tsx|jsx)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|\.react-router|\.generated|coverage|corpus|\.tmp[^/]*)(\/|$)/;

const OPT_IN_CLASS = "agent-native-search-input";
// instead of the shared class. Either one satisfies the invariant.
const INLINE_SUPPRESSION_RE =
  /\[&::-webkit-search-cancel-button\]:appearance-none/;
const SEARCH_TYPE_RE = /type=(?:["']search["']|\{\s*["']search["']\s*\})/;
const BUTTON_OPEN_RE = /<(button|Button)\b/;
const BUTTON_CLOSE_RE = /\/>|<\/(button|Button)>/;
const ACCESSIBLE_CLEAR_RE =
  /(?:aria-label|title)=(?:"[^"]*clear[^"]*"|\{[^}]*[Cc]lear[^}]*\})/i;
const ALLOW_PRAGMA = /guard:allow-duplicate-search-clear\b/;
const WRAPPER_LOOKAHEAD_LINES = 18;

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.error(
      `guard-single-search-clear: cannot read ${path.relative(REPO_ROOT, directory) || directory} - ${error.message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(REPO_ROOT, absolutePath)
      .replaceAll("\\", "/");
    if (EXCLUDED_PATH.test(relativePath)) continue;
    if (entry.isDirectory()) walk(absolutePath, files);
    else if (SOURCE_EXTENSIONS.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

function elementAround(lines, index) {
  let start = index;
  while (start > 0 && !/<(input|Input)\b/.test(lines[start])) start -= 1;
  let end = index;
  while (end < lines.length - 1 && !/\/>|><\/(input|Input)>/.test(lines[end])) {
    end += 1;
  }
  return { start, end, text: lines.slice(start, end + 1).join("\n") };
}

function hasOwnClearButton(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!BUTTON_OPEN_RE.test(lines[index])) continue;
    let end = index;
    while (end < lines.length - 1 && !BUTTON_CLOSE_RE.test(lines[end])) {
      end += 1;
    }
    const block = lines.slice(index, end + 1).join("\n");
    if (ACCESSIBLE_CLEAR_RE.test(block)) return true;
    index = end;
  }
  return false;
}

function main() {
  const violations = [];
  let checked = 0;

  for (const root of SOURCE_ROOTS) {
    const absoluteRoot = path.join(REPO_ROOT, root);
    if (!existsSync(absoluteRoot)) {
      console.error(
        `guard-single-search-clear: source root ${root} is missing; the scan would silently cover less than the repo.`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    for (const absolutePath of walk(absoluteRoot)) {
      // invariant rather than a scan that never happened.
      let source;
      try {
        source = readFileSync(absolutePath, "utf8");
      } catch (error) {
        console.error(
          `guard-single-search-clear: cannot read ${path.relative(REPO_ROOT, absolutePath)} - ${error.message}`,
        );
        process.exit(GUARD_EXIT_COULD_NOT_RUN);
      }
      if (!SEARCH_TYPE_RE.test(source)) continue;
      const lines = source.split("\n");
      const file = path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");

      for (const [index, line] of lines.entries()) {
        if (!SEARCH_TYPE_RE.test(line)) continue;
        checked += 1;
        const element = elementAround(lines, index);
        if (ALLOW_PRAGMA.test(lines[element.start - 1] ?? "")) continue;

        const optedIn =
          element.text.includes(OPT_IN_CLASS) ||
          INLINE_SUPPRESSION_RE.test(element.text);
        const following = lines.slice(
          element.end + 1,
          element.end + 1 + WRAPPER_LOOKAHEAD_LINES,
        );
        const hasOwnClear = hasOwnClearButton(following);

        if (hasOwnClear && !optedIn) {
          violations.push({
            file,
            lineNumber: index + 1,
            problem: `renders its own clear button but is missing \`${OPT_IN_CLASS}\`, so WebKit's cancel widget shows a second "x"`,
          });
        } else if (optedIn && !hasOwnClear) {
          violations.push({
            file,
            lineNumber: index + 1,
            problem: `carries \`${OPT_IN_CLASS}\` but renders no clear button, so the field has no way to clear in WebKit`,
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `guard-single-search-clear: OK (${checked} search field(s) checked; each has exactly one clear affordance)`,
    );
    return;
  }

  console.error(
    `\nguard-single-search-clear: ${violations.length} search field(s) with the wrong number of clear controls.\n`,
  );
  console.error(
    `Add \`${OPT_IN_CLASS}\` to the input's className when the field renders its own\n` +
      `clear button, and remove it when it does not. The stylesheet rule lives in\n` +
      `packages/core/src/styles/agent-native.css.\n`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.lineNumber}  ${violation.problem}`,
    );
  }
  process.exitCode = 1;
}

main();
