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
 * `search-field-owns-clear`, because a field with no clear button of its own
 * still needs it. That makes the pairing the invariant worth checking: a
 * search input whose wrapper renders a clear button must carry the class, and
 * a field carrying the class must actually render one.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SOURCE_ROOTS = ["packages", "templates", "examples"];
const SOURCE_EXTENSIONS = /\.(tsx|jsx)$/;
const EXCLUDED_PATH =
  /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.output|\.cache|\.turbo|\.netlify|\.vercel|\.wrangler|\.react-router|\.generated|coverage|corpus|\.tmp[^/]*)(\/|$)/;

const OPT_IN_CLASS = "search-field-owns-clear";
// A clear control belonging to this field: an icon button whose accessible
// name says "clear", rendered inside the same relative wrapper.
const CLEAR_CONTROL_RE =
  /aria-label=(?:"[^"]*clear[^"]*"|\{[^}]*[Cc]lear[^}]*\})/i;
const ALLOW_PRAGMA = /guard:allow-duplicate-search-clear\b/;
// The wrapper that positions an absolute clear button. Scanning past it would
// pick up unrelated "clear filters" controls elsewhere on the page.
const WRAPPER_LOOKAHEAD_LINES = 18;

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
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

/** The JSX attributes of the element containing `type="search"` at `index`. */
function elementAround(lines, index) {
  let start = index;
  while (start > 0 && !/<(input|Input)\b/.test(lines[start])) start -= 1;
  let end = index;
  while (end < lines.length - 1 && !/\/>|><\/(input|Input)>/.test(lines[end])) {
    end += 1;
  }
  return { start, end, text: lines.slice(start, end + 1).join("\n") };
}

function main() {
  const violations = [];
  let checked = 0;

  for (const root of SOURCE_ROOTS) {
    for (const absolutePath of walk(path.join(REPO_ROOT, root))) {
      const source = readFileSync(absolutePath, "utf8");
      if (!source.includes('type="search"')) continue;
      const lines = source.split("\n");
      const file = path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/");

      for (const [index, line] of lines.entries()) {
        if (!line.includes('type="search"')) continue;
        checked += 1;
        const element = elementAround(lines, index);
        if (ALLOW_PRAGMA.test(lines[element.start - 1] ?? "")) continue;

        const optedIn = element.text.includes(OPT_IN_CLASS);
        const following = lines
          .slice(element.end + 1, element.end + 1 + WRAPPER_LOOKAHEAD_LINES)
          .join("\n");
        const hasOwnClear = CLEAR_CONTROL_RE.test(following);

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
