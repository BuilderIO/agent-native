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

function toRepoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

function isExcluded(relPath: string): boolean {
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

function collectDocFiles(): string[] {
  const files = new Set<string>();

  for (const f of preferMdxDocSourceFiles(
    walk(join(REPO_ROOT, "packages/core/docs/content"), (_rel, base) =>
      isDocSourceFile(base),
    ),
  )) {
    files.add(f);
  }

  for (const f of walk(
    join(REPO_ROOT, ".agents/skills"),
    (_rel, base) => base === "SKILL.md",
  )) {
    files.add(f);
  }

  for (const f of walk(
    join(REPO_ROOT, "packages/core/src/templates"),
    (rel, base) => base === "SKILL.md" && rel.includes("/.agents/skills/"),
  )) {
    files.add(f);
  }

  for (const f of walk(
    join(REPO_ROOT, "templates"),
    (_rel, base) => base === "AGENTS.md",
  )) {
    files.add(f);
  }

  for (const f of walk(
    join(REPO_ROOT, "packages/core/src/templates"),
    (_rel, base) => base === "AGENTS.md",
  )) {
    files.add(f);
  }

  return [...files].sort();
}

const ALL_DOC_FILES = collectDocFiles();

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
  id: string;
  pattern: RegExp;
  scope: "all" | string;
  message: string;
  ignoreLine?: (lines: string[], lineIdx: number) => boolean;
}

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
  const hits = adapterSignals.filter((re) => re.test(windowText)).length;
  return hits >= 2;
}

const RULES: Rule[] = [
  {
    id: "org-plugin-built-in",
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
    ignoreLine: isExternalSessionAdapterLine,
  },
  {
    id: "force-fire-recurring-jobs",
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
    id: "wisprflow-typo",
    pattern: /Wisprflow/i,
    scope: "all",
    message: 'Use "Wispr Flow" (two words) if referencing it at all.',
  },
  {
    id: "content-db-push",
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
    expect(ALL_DOC_FILES.length).toBeGreaterThan(0);
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
