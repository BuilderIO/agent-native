import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  UI_PLAN_SKILL_MD,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_QUESTIONS_SKILL_MD,
  VISUALIZE_PLAN_SKILL_MD,
} from "./skills.js";

/**
 * The four Plans skills are stored in three places that ship to users:
 *   1. the shipped constants in skills.ts (what `agent-native skills add`
 *      materializes for every host),
 *   2. templates/plan/.agents/skills/<name>/SKILL.md (the template copy),
 *   3. skills/<name>/SKILL.md (the top-level exported mirror).
 *
 * Historically these drifted silently (the shipped constant once said "author a
 * complete bespoke html document" while the template copies had already moved on
 * to structured content). This guard fails the moment any copy drifts so the
 * three stay a single source of truth, and it forbids the stale
 * "bespoke html" / "standalone HTML document" phrasing outside the explicit
 * legacy-import caveat.
 */

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

const ROOT = workspaceRoot();

// Each Plans skill: the shipped constant + its template path + its top-level
// mirror path. The template uses the canonical singular `visual-plan` directory;
// the top-level mirror exports the headline command as `visual-plans` (plural).
const PLAN_SKILLS = [
  {
    label: "visual-plan",
    constant: VISUAL_PLANS_SKILL_MD,
    templateDir: "visual-plan",
    exportedDir: "visual-plans",
    hasCores: true,
  },
  {
    label: "ui-plan",
    constant: UI_PLAN_SKILL_MD,
    templateDir: "ui-plan",
    exportedDir: "ui-plan",
    hasCores: true,
  },
  {
    label: "visualize-plan",
    constant: VISUALIZE_PLAN_SKILL_MD,
    templateDir: "visualize-plan",
    exportedDir: "visualize-plan",
    hasCores: true,
  },
  {
    label: "visual-questions",
    constant: VISUAL_QUESTIONS_SKILL_MD,
    templateDir: "visual-questions",
    exportedDir: "visual-questions",
    hasCores: false,
  },
] as const;

function templatePath(dir: string): string {
  return path.join(
    ROOT,
    "templates",
    "plan",
    ".agents",
    "skills",
    dir,
    "SKILL.md",
  );
}

function exportedPath(dir: string): string {
  return path.join(ROOT, "skills", dir, "SKILL.md");
}

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function extractSharedCore(md: string, marker: string): string {
  const start = `<!-- SHARED-CORE:${marker} START -->`;
  const end = `<!-- SHARED-CORE:${marker} END -->`;
  const startIdx = md.indexOf(start);
  const endIdx = md.indexOf(end);
  expect(startIdx, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIdx, `missing ${end}`).toBeGreaterThan(startIdx);
  return md.slice(startIdx, endIdx + end.length);
}

// "standalone HTML document" and "bespoke html" are only allowed where the text
// is explicitly describing the legacy-import fallback.
function findStaleHtmlPhrasing(md: string): string[] {
  const offenders: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (!lower.includes("bespoke html") && !lower.includes("standalone html")) {
      continue;
    }
    // Gather a small window of context to detect the legacy caveat.
    const window = lines
      .slice(Math.max(0, i - 2), i + 2)
      .join(" ")
      .toLowerCase();
    const isLegacyCaveat =
      window.includes("legacy") ||
      window.includes("never emit") ||
      window.includes("only for");
    if (!isLegacyCaveat) {
      offenders.push(lines[i].trim());
    }
  }
  return offenders;
}

describe("Plans skills sync guard", () => {
  it("keeps the shipped constant, template copy, and exported mirror byte-identical", () => {
    for (const skill of PLAN_SKILLS) {
      const template = read(templatePath(skill.templateDir));
      const exported = read(exportedPath(skill.exportedDir));
      expect(template, `${skill.label}: template vs constant`).toBe(
        skill.constant,
      );
      expect(exported, `${skill.label}: exported mirror vs constant`).toBe(
        skill.constant,
      );
    }
  });

  it("keeps the shared Wireframe & Document cores identical across plan skills", () => {
    const coreMarkers = [
      "wireframe-canvas",
      "document-quality",
      "exemplar",
    ] as const;
    const coreSkills = PLAN_SKILLS.filter((s) => s.hasCores);
    for (const marker of coreMarkers) {
      const cores = coreSkills.map((s) =>
        extractSharedCore(s.constant, marker),
      );
      const [first, ...rest] = cores;
      for (let i = 0; i < rest.length; i += 1) {
        expect(
          rest[i],
          `shared core "${marker}" drifted between ${coreSkills[0].label} and ${coreSkills[i + 1].label}`,
        ).toBe(first);
      }
    }
  });

  it("forbids stale bespoke/standalone HTML guidance outside the legacy caveat", () => {
    for (const skill of PLAN_SKILLS) {
      const offenders = findStaleHtmlPhrasing(skill.constant);
      expect(
        offenders,
        `${skill.label} contains stale full-HTML guidance: ${offenders.join(" | ")}`,
      ).toEqual([]);
    }
  });

  it("uses /visual-plan (singular) as the canonical command name", () => {
    // The headline skill must declare itself `name: visual-plan` and the body
    // must call the canonical command `/visual-plan`.
    expect(VISUAL_PLANS_SKILL_MD).toMatch(/^---\nname: visual-plan\n/);
    expect(VISUAL_PLANS_SKILL_MD).toContain("`/visual-plan`");
  });
});
