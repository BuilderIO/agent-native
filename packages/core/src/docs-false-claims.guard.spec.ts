import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

/**
 * Regression guard for known-false documentation claims.
 *
 * We audited the docs and fixed a batch of factually-wrong statements. This
 * test locks those fixes in: it scans every documentation surface at runtime
 * via the filesystem and fails if any of the corrected falsehoods reappear in
 * any form on the denylist.
 *
 * IMPORTANT for maintainers: each denylist pattern is written to match the
 * FALSE phrasing only. Several corrected passages deliberately mention the same
 * topic (e.g. "there's no force-fire tool", "has no `db:push` script", "not
 * Better Auth's organization plugin, which is intentionally not registered").
 * Patterns are deliberately narrow so they do NOT match that corrected text. If
 * you need to change a pattern, re-verify it stays green against the current
 * tree and only matches the false form — do NOT edit docs to satisfy the test.
 */

// The test file lives at packages/core/src, so the repo root is three levels up.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..", "..", "..");

const EXCLUDED_PATH_SEGMENTS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.output/",
  "/.claude/worktrees/",
];

/** Normalize to a forward-slash, repo-relative path. */
function toRepoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

function isExcluded(relPath: string): boolean {
  // Wrap with leading/trailing slashes so segment matches are anchored on
  // directory boundaries (e.g. "/dist/" never matches "redistribute").
  const padded = `/${relPath}/`;
  return EXCLUDED_PATH_SEGMENTS.some((seg) => padded.includes(seg));
}

function isDocSourceFile(baseName: string): boolean {
  return baseName.endsWith(".mdx") || baseName.endsWith(".md");
}

function pathWithoutDocSourceExtension(relPath: string): string {
  return relPath.replace(/\.(?:mdx|md)$/, "");
}

function preferMdxDocSourceFiles(files: string[]): string[] {
  const byPath = new Map<string, string>();
  for (const file of [...files].sort()) {
    const pathWithoutExtension = pathWithoutDocSourceExtension(file);
    const existing = byPath.get(pathWithoutExtension);
    if (!existing || file.endsWith(".mdx")) {
      byPath.set(pathWithoutExtension, file);
    }
  }
  return Array.from(byPath.values()).sort();
}

/**
 * Recursively collect files under `startDir` whose basename matches one of
 * `fileNames`, or (when `fileNames` is "*.md") any markdown file. Returns
 * repo-relative, forward-slash paths. Silently skips missing directories.
 */
function walk(
  startDir: string,
  match: (relPath: string, baseName: string) => boolean,
): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(startDir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(startDir, entry);
    const rel = toRepoRelative(abs);
    if (isExcluded(rel)) continue;
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walk(abs, match));
    } else if (stat.isFile() && match(rel, entry)) {
      out.push(rel);
    }
  }
  return out;
}

/** Collect all documentation files across the four surfaces, deduped & sorted. */
function collectDocFiles(): string[] {
  const files = new Set<string>();

  // 1. Published docs site.
  for (const f of preferMdxDocSourceFiles(
    walk(join(REPO_ROOT, "packages/core/docs/content"), (_rel, base) =>
      isDocSourceFile(base),
    ),
  )) {
    files.add(f);
  }

  // 2. Top-level / framework-dev skills.
  for (const f of walk(
    join(REPO_ROOT, ".agents/skills"),
    (_rel, base) => base === "SKILL.md",
  )) {
    files.add(f);
  }

  // 3. Shipped skills inside templates packaged in core.
  for (const f of walk(
    join(REPO_ROOT, "packages/core/src/templates"),
    (rel, base) => base === "SKILL.md" && rel.includes("/.agents/skills/"),
  )) {
    files.add(f);
  }

  // 4a. Top-level template AGENTS.md guides.
  for (const f of walk(
    join(REPO_ROOT, "templates"),
    (_rel, base) => base === "AGENTS.md",
  )) {
    files.add(f);
  }

  // 4b. Shipped template AGENTS.md guides.
  for (const f of walk(
    join(REPO_ROOT, "packages/core/src/templates"),
    (_rel, base) => base === "AGENTS.md",
  )) {
    files.add(f);
  }

  return [...files].sort();
}

const ALL_DOC_FILES = collectDocFiles();

/** Cache file contents (split into lines) so each rule doesn't re-read. */
const fileLinesCache = new Map<string, string[]>();
function linesFor(relPath: string): string[] {
  let cached = fileLinesCache.get(relPath);
  if (!cached) {
    const text = readFileSync(join(REPO_ROOT, relPath), "utf8");
    cached = text.split(/\r?\n/);
    fileLinesCache.set(relPath, cached);
  }
  return cached;
}

interface Rule {
  /** Stable id for readable failure output. */
  id: string;
  /** The regex matching ONLY the false phrasing. */
  pattern: RegExp;
  /**
   * Either "all" (every collected doc file) or a single repo-relative file
   * path to restrict the rule to one document.
   */
  scope: "all" | string;
  /** Human-readable explanation shown on violation. */
  message: string;
  /**
   * Optional line-level allowlist. Return true to treat a regex hit on this
   * line as legitimate (NOT a false claim). Used for passages that
   * deliberately use the topic correctly — e.g. mapping an EXTERNAL host
   * session (whose shape really is nested) into the framework's flat auth
   * contract. `lines` is the full file (0-indexed); `lineIdx` is the matched
   * line's 0-based index.
   */
  ignoreLine?: (lines: string[], lineIdx: number) => boolean;
}

/**
 * Recognizes the legitimate "external host session → framework auth" adapter:
 * a block that maps a nested third-party session (Better Auth raw session,
 * getBuilderSession, Clerk/Auth.js, etc.) into the framework's flat AuthSession
 * shape. Such blocks legitimately read `session.user.*` / `session.organization.*`
 * because that nested object is NOT the framework AuthSession. We only exempt a
 * `session.user.email` line when its surrounding window also adapts other nested
 * fields, which is the unmistakable signature of host-session mapping.
 */
function isExternalSessionAdapterLine(
  lines: string[],
  lineIdx: number,
): boolean {
  const start = Math.max(0, lineIdx - 8);
  const end = Math.min(lines.length, lineIdx + 9);
  const windowText = lines.slice(start, end).join("\n");
  const adapterSignals = [
    /getBuilderSession/,
    /session\s*\.\s*organization\s*\.\s*\w/,
    /session\s*\.\s*user\s*\.\s*(id|name)\b/,
  ];
  // Require at least two independent host-session signals so a lone, genuinely
  // wrong `session.user.email` (claiming the framework session is nested) is
  // still caught.
  const hits = adapterSignals.filter((re) => re.test(windowText)).length;
  return hits >= 2;
}

const RULES: Rule[] = [
  {
    id: "org-plugin-built-in",
    // "organization plugin is built in", "organizations plugin is built in",
    // "uses Better Auth's organizations plugin", and "...Better Auth and its
    // organizations plugin". Must NOT match the corrected "not Better Auth's
    // organization plugin, which is intentionally not registered".
    pattern:
      /(organizations?\s+plugin\s+is\s+built[\s-]?in)|(uses\s+better\s?-?\s?auth['’]?s?\s+organizations?\s+plugin)|(and\s+its\s+organizations?\s+plugin)/i,
    scope: "all",
    message:
      "Better Auth's org plugin is intentionally NOT registered; don't claim it's built-in/used. Orgs are the framework's own org/ module.",
  },
  {
    id: "phantom-getDb-import",
    pattern: /getDb\s*\}\s*from\s*["'`]@agent-native\/core\/db["'`]/,
    scope: "all",
    message:
      "getDb is not exported from @agent-native/core/db; import it from the app's server/db/index.js (it's created via createGetDb(schema)).",
  },
  {
    id: "nested-auth-session-shape",
    pattern: /session\s*\??\.\s*user\s*\??\.\s*email/i,
    scope: "all",
    message: "AuthSession is flat — use session.email, not session.user.email.",
    // Exempt host-session adapter blocks (e.g. embedding-sdk.md's
    // getBuilderSession mapping), where `session` is an external nested
    // session being mapped INTO the framework's flat auth contract.
    ignoreLine: isExternalSessionAdapterLine,
  },
  {
    id: "force-fire-recurring-jobs",
    // Affirmative claims only. Must NOT match the corrected negative
    // "there's no force-fire tool".
    pattern:
      /(force-?fire\s+it)|(scheduler\s+tool\s+to\s+force-?fire)|(run\s+the\s+.{0,40}\s+job\s+.{0,20}(right\s+now|now)\b.{0,40}(scheduler|tool|force))/i,
    scope: "all",
    message:
      "There is no force-fire/run-now job tool (manage-jobs is create/list/update/delete only).",
  },
  {
    id: "slides-fake-eight-layouts",
    pattern: /eight\s+(slide\s+)?layouts/i,
    scope: "packages/core/docs/content/template-slides.mdx",
    message:
      "Slides has 7 real layouts in .agents/skills/create-deck/SKILL.md; there is no image/full-bleed/blank layout.",
  },
  {
    id: "slides-fake-full-bleed",
    pattern: /\bfull-bleed\b/i,
    scope: "packages/core/docs/content/template-slides.mdx",
    message:
      "Slides has 7 real layouts in .agents/skills/create-deck/SKILL.md; there is no image/full-bleed/blank layout.",
  },
  {
    id: "slides-fake-blank-layout",
    pattern: /\bblank\s+layout\b/i,
    scope: "packages/core/docs/content/template-slides.mdx",
    message:
      "Slides has 7 real layouts in .agents/skills/create-deck/SKILL.md; there is no image/full-bleed/blank layout.",
  },
  {
    id: "videos-twelve-compositions",
    pattern: /twelve\s+(example\s+)?compositions|12\s+example\s+compositions/i,
    scope: "packages/core/docs/content/template-videos.mdx",
    message:
      "Video compositions are DB-backed; only BlankComposition ships in code.",
  },
  {
    id: "wisprflow-typo",
    pattern: /Wisprflow/i,
    scope: "all",
    message: 'Use "Wispr Flow" (two words) if referencing it at all.',
  },
  {
    id: "content-db-push",
    // Match `db:push` only when NOT part of the corrected negative
    // "has no `db:push` script".
    pattern: /(?<!no\s)(?<!no\s`)\bdb:push\b/i,
    scope: "packages/core/docs/content/template-content.mdx",
    message:
      "The content template has no db:push script; it uses additive startup migrations.",
  },
];

interface Violation {
  file: string;
  line: number;
  text: string;
}

function filesInScope(rule: Rule): string[] {
  if (rule.scope === "all") return ALL_DOC_FILES;
  // Single-file scope: only include it if it was actually collected
  // (i.e. it exists and isn't excluded).
  const scope =
    ALL_DOC_FILES.find((file) => file === rule.scope) ??
    (rule.scope.endsWith(".md")
      ? ALL_DOC_FILES.find(
          (file) => file === rule.scope.replace(/\.md$/, ".mdx"),
        )
      : undefined);
  return scope ? [scope] : [];
}

function findViolations(rule: Rule): Violation[] {
  const violations: Violation[] = [];
  // Use a global, multi-line-agnostic copy so we can scan line by line.
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  for (const file of filesInScope(rule)) {
    const lines = linesFor(file);
    lines.forEach((text, idx) => {
      if (!re.test(text)) return;
      if (rule.ignoreLine?.(lines, idx)) return;
      violations.push({ file, line: idx + 1, text: text.trim() });
    });
  }
  return violations;
}

function dump(rule: Rule, violations: Violation[]): string {
  const header = `\nFalse-claim guard "${rule.id}" found ${violations.length} violation(s):\n  ${rule.message}\n`;
  const body = violations
    .map((v) => `  ${v.file}:${v.line}\n    > ${v.text}`)
    .join("\n");
  return `${header}\n${body}\n`;
}

describe("docs false-claim regression guard", () => {
  it("collected documentation files across all four surfaces", () => {
    // Sanity check: if the walker found nothing, the guard would be a no-op.
    expect(ALL_DOC_FILES.length).toBeGreaterThan(0);
    // The known scoped target files must be present, otherwise scoped rules
    // would silently pass without ever scanning anything.
    for (const scoped of new Set(
      RULES.map((r) => r.scope).filter((s): s is string => s !== "all"),
    )) {
      expect(
        filesInScope({
          id: "scope-check",
          pattern: /$^/,
          scope: scoped,
          message: "",
        }).length,
        `Scoped target file not collected: ${scoped}`,
      ).toBe(1);
    }
  });

  for (const rule of RULES) {
    it(`no false claim: ${rule.id}`, () => {
      const violations = findViolations(rule);
      expect(violations, dump(rule, violations)).toEqual([]);
    });
  }
});
