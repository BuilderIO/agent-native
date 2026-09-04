#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * guard:persistent-compositing
 *
 * Chromium composites an element into its own layer when you ask it to, and it
 * keeps that layer for as long as the element lives. On a surface that never
 * unmounts — an app shell, a sidebar, a canvas, a virtualized row — that is a
 * permanent allocation, and enough of them show up as flow content painting as
 * flat unpainted rectangles while only the promoted elements survive. That is
 * the "rasterizing glitchiness" class of bug: it reads as a GPU problem, and
 * every individual declaration reads as a harmless performance hint, which is
 * why it kept coming back across apps.
 *
 * This guard is a whole-tree scan against a checked-in baseline rather than a
 * diff-scoped check. A diff-scoped guard that cannot resolve its base has to
 * choose between a false pass and a false failure, and the two guards in this
 * repo that made that choice both pass — silently checking zero lines. A
 * baseline cannot do that: every offender is either listed or it fails.
 *
 * Two ways to accept a flagged line:
 *   1. A `compositing-ok: <reason>` comment on the line or the line above.
 *      Use this for genuinely transient elements — a popover that mounts on
 *      open and unmounts on close retires its layer with itself.
 *   2. An entry in scripts/persistent-compositing-baseline.txt. Regenerate with
 *      UPDATE_PERSISTENT_COMPOSITING_BASELINE=1 pnpm guard:persistent-compositing
 *      only after confirming each new entry is expected debt, not a fresh miss.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "persistent-compositing-baseline.txt",
);

const SCAN_DIRS = ["packages", "templates", "apps"];
const SCAN_EXT = new Set([".css", ".ts", ".tsx"]);
/** The corpus is a scaffolding mirror of templates/; fixing it twice is noise. */
const EXCLUDE_RE =
  /(^|\/)(node_modules|dist|build|\.wrangler|coverage)(\/|$)|\/corpus\/|\.(spec|test)\.[jt]sx?$/;

const PRAGMA_RE = /compositing-ok:/;
/** A justified pragma is usually a multi-line comment above the declaration. */
const PRAGMA_LOOKBACK = 4;

/** Each rule returns a short reason string when `line` violates it. */
const RULES = [
  {
    id: "will-change",
    test: (line) => {
      const declares =
        /(^|[^-\w])will-change\s*:/.test(line) || /\bwill-change-\[/.test(line);
      if (!declares) return false;
      // `phase !== "idle" && "will-change-[…]"` is the correct form: the hint
      // exists only while the element is actually animating.
      if (/&&\s*$|&&\s*["'`]/.test(line.split("will-change")[0] ?? "")) {
        return false;
      }
      return true;
    },
    reason:
      "will-change is never retired on a long-lived element — it pins a composited layer for the life of the page. Chromium already promotes a transition while it runs.",
  },
  {
    id: "view-transition-name",
    test: (line) => {
      if (!/viewTransitionName\s*:|view-transition-name\s*:/.test(line))
        return false;
      // Conditional application (`cond ? { viewTransitionName: … }`) is the
      // correct form: the name exists only while a transition is capturing.
      if (/\?\s*\{/.test(line)) return false;
      // Type declarations and constant definitions are not applications.
      if (/viewTransitionName\??\s*:\s*string/.test(line)) return false;
      if (/@supports|::view-transition/.test(line)) return false;
      return true;
    },
    reason:
      "a permanent view-transition-name makes the element a stacking context and the containing block for fixed/absolute descendants, and enlists it as a captured group in unrelated route transitions. Apply it only while the transition runs.",
  },
];

function listFiles() {
  // `--others --exclude-standard` includes new files that are not staged yet, so
  // a local run catches a violation before it is ever committed. `git ls-files`
  // alone silently skips them, which makes the guard look clean on exactly the
  // code someone is about to push.
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...SCAN_DIRS,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .filter((p) => SCAN_EXT.has(path.extname(p)) && !EXCLUDE_RE.test(p));
}

/**
 * Blank out comment bodies while preserving line count and column offsets. The
 * declarations this guard forbids are also *named* in the comments explaining
 * why they are forbidden, so a scanner that reads comments flags its own
 * documentation — and a guard that prose can trip is a guard nobody trusts.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | single | double | backtick
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    const keep = (n) => {
      out += src.slice(i, i + n);
      i += n;
    };
    const blank = (n) => {
      for (let k = 0; k < n; k++) out += src[i + k] === "\n" ? "\n" : " ";
      i += n;
    };

    if (mode === "code") {
      if (ch === "/" && next === "/") ((mode = "line"), blank(2));
      else if (ch === "/" && next === "*") ((mode = "block"), blank(2));
      else if (ch === "'") ((mode = "single"), keep(1));
      else if (ch === '"') ((mode = "double"), keep(1));
      else if (ch === "`") ((mode = "backtick"), keep(1));
      else keep(1);
    } else if (mode === "line") {
      if (ch === "\n") ((mode = "code"), keep(1));
      else blank(1);
    } else if (mode === "block") {
      if (ch === "*" && next === "/") ((mode = "code"), blank(2));
      else blank(1);
    } else {
      // Inside a string: honour escapes so a quote in a class list can't end it.
      if (ch === "\\") keep(2);
      else if (
        (mode === "single" && ch === "'") ||
        (mode === "double" && ch === '"') ||
        (mode === "backtick" && ch === "`")
      )
        ((mode = "code"), keep(1));
      else keep(1);
    }
  }
  return out;
}

/** Baseline keys are path + rule + normalized snippet, so they survive edits
 *  elsewhere in the file but not a change to the offending line itself. */
function keyFor(relPath, ruleId, lineText) {
  return `${relPath}\t${ruleId}\t${lineText.trim().replace(/\s+/g, " ").slice(0, 160)}`;
}

function collect() {
  const found = [];
  for (const relPath of listFiles()) {
    let src;
    try {
      src = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    } catch {
      continue;
    }
    if (!/will-change|iewTransitionName|view-transition-name/.test(src))
      continue;

    const rawLines = src.split("\n");
    const lines = stripComments(src).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (lineText === undefined) continue;
      // Pragmas live in the comments we just blanked, so read them from source.
      // Look back a few lines: a pragma that needs a sentence of justification
      // is a multi-line comment, and the reason is the point of the pragma.
      const window = rawLines.slice(Math.max(0, i - PRAGMA_LOOKBACK), i + 1);
      if (window.some((l) => PRAGMA_RE.test(l))) continue;

      for (const rule of RULES) {
        if (!rule.test(lineText)) continue;
        found.push({
          key: keyFor(relPath, rule.id, lineText),
          relPath,
          line: i + 1,
          ruleId: rule.id,
          reason: rule.reason,
          snippet: lineText.trim().slice(0, 140),
        });
      }
    }
  }
  return found;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  return new Set(
    readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l && !l.startsWith("#")),
  );
}

function main() {
  const found = collect();

  if (process.env.UPDATE_PERSISTENT_COMPOSITING_BASELINE === "1") {
    const header = [
      "# guard:persistent-compositing baseline",
      "#",
      "# Pre-existing compositing promotions on long-lived surfaces. Each line is",
      "# <path>\\t<rule>\\t<normalized snippet>. Shrink this file; do not grow it.",
      "# Regenerate: UPDATE_PERSISTENT_COMPOSITING_BASELINE=1 pnpm guard:persistent-compositing",
      "",
    ].join("\n");
    const body = [...new Set(found.map((f) => f.key))].sort().join("\n");
    writeFileSync(BASELINE_PATH, `${header}${body}\n`, "utf8");
    console.log(
      `guard-persistent-compositing: baseline written with ${found.length} entr(ies).`,
    );
    return;
  }

  const baseline = readBaseline();
  const violations = found.filter((f) => !baseline.has(f.key));

  if (violations.length === 0) {
    console.log(
      `guard-persistent-compositing: OK (${found.length} baselined, 0 new).`,
    );
    return;
  }

  console.error(
    `[guard:persistent-compositing] ${violations.length} new compositing promotion(s) on long-lived surfaces:`,
  );
  for (const v of violations) {
    console.error(`- ${v.relPath}:${v.line}  [${v.ruleId}]`);
    console.error(`    ${v.snippet}`);
    console.error(`    ${v.reason}`);
  }
  console.error(
    "\nFix:\n" +
      "  - Remove the declaration. A CSS transition is promoted by the browser while it runs.\n" +
      "  - If the element genuinely mounts and unmounts with its animation (a popover,\n" +
      "    a toast), add `compositing-ok: <reason>` on the line or the line above.\n" +
      "  - If this is reviewed pre-existing debt, record it with\n" +
      "    UPDATE_PERSISTENT_COMPOSITING_BASELINE=1 pnpm guard:persistent-compositing\n",
  );
  process.exitCode = 1;
}

main();
