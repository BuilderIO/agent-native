import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VISUAL_PLANS_SKILL_MD, VISUAL_RECAP_SKILL_MD } from "./skills.js";

/**
 * The Plans skills are stored in four places that ship to users or guide this
 * repo's own coding agents:
 *   1. the shipped constants in skills.ts (what `agent-native skills add`
 *      materializes for every host),
 *   2. templates/plan/.agents/skills/<name>/SKILL.md (the template copy),
 *   3. skills/<name>/SKILL.md (the top-level exported mirror).
 *   4. .agents/skills/<name>/SKILL.md (the repo-local installed skill).
 *
 * Historically these drifted silently (the shipped constant once said "author a
 * complete bespoke html document" while the template copies had already moved on
 * to structured content). This guard fails the moment any copy drifts so the
 * copies stay a single source of truth, and it forbids the stale
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
// `cores` lists the SHARED-CORE marker regions a skill interpolates from the
// single-source partials in skills.ts. The `wireframe-quality` core is shared
// across visual-plan AND visual-recap; the canvas/document/exemplar cores apply
// only to the canvas-bearing visual-plan.
const PLAN_SKILLS = [
  {
    label: "visual-plan",
    constant: VISUAL_PLANS_SKILL_MD,
    templateDir: "visual-plan",
    exportedDir: "visual-plans",
    cores: [
      "wireframe-quality",
      "canvas-surface",
      "document-quality",
      "exemplar",
    ],
  },
  {
    label: "visual-recap",
    constant: VISUAL_RECAP_SKILL_MD,
    templateDir: "visual-recap",
    exportedDir: "visual-recap",
    cores: ["wireframe-quality"],
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

function repoSkillPath(dir: string): string {
  return path.join(ROOT, ".agents", "skills", dir, "SKILL.md");
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
  it("keeps the shipped constant, template copy, exported mirror, and repo-local skill byte-identical", () => {
    for (const skill of PLAN_SKILLS) {
      const template = read(templatePath(skill.templateDir));
      const exported = read(exportedPath(skill.exportedDir));
      const repoLocal = read(repoSkillPath(skill.label));
      expect(template, `${skill.label}: template vs constant`).toBe(
        skill.constant,
      );
      expect(exported, `${skill.label}: exported mirror vs constant`).toBe(
        skill.constant,
      );
      expect(repoLocal, `${skill.label}: repo-local skill vs constant`).toBe(
        skill.constant,
      );
    }
  });

  it("keeps the Plans app skill manifest aligned with installable plan skills", () => {
    const manifest = JSON.parse(
      read(path.join(ROOT, "templates", "plan", "agent-native.app-skill.json")),
    ) as {
      skills: Array<{
        path: string;
        visibility: string;
        exportAs?: string;
      }>;
    };

    expect(
      manifest.skills.map((skill) => ({
        path: skill.path,
        visibility: skill.visibility,
        exportAs: skill.exportAs,
      })),
    ).toEqual(
      PLAN_SKILLS.map((skill) => ({
        path: `.agents/skills/${skill.templateDir}`,
        visibility: "both",
        exportAs: skill.label,
      })),
    );
  });

  it("keeps each shared core byte-identical across the skills that consume it", () => {
    // Each marker is single-sourced from one partial in skills.ts and
    // interpolated into its consumers. `wireframe-quality` is shared by
    // visual-plan and visual-recap; the canvas/document/exemplar cores by
    // visual-plan only.
    const coreMarkers = [
      "wireframe-quality",
      "canvas-surface",
      "document-quality",
      "exemplar",
    ] as const;
    for (const marker of coreMarkers) {
      const consumers = PLAN_SKILLS.filter((s) =>
        (s.cores as readonly string[]).includes(marker),
      );
      expect(
        consumers.length,
        `no skill declares it consumes shared core "${marker}"`,
      ).toBeGreaterThan(0);
      const regions = consumers.map((s) =>
        extractSharedCore(s.constant, marker),
      );
      const [first, ...rest] = regions;
      for (let i = 0; i < rest.length; i += 1) {
        expect(
          rest[i],
          `shared core "${marker}" drifted between ${consumers[0].label} and ${consumers[i + 1].label}`,
        ).toBe(first);
      }
      // A skill that does not declare the core must not carry the marker, so
      // an undeclared copy can never silently drift.
      for (const s of PLAN_SKILLS) {
        if ((s.cores as readonly string[]).includes(marker)) continue;
        expect(
          s.constant.includes(`<!-- SHARED-CORE:${marker} START -->`),
          `${s.label} carries shared core "${marker}" without declaring it in PLAN_SKILLS.cores`,
        ).toBe(false);
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
