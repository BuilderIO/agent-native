import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  WIREFRAME_REFERENCE_MD,
} from "./skills.js";

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
// `cores` lists the SHARED-CORE marker regions a skill still interpolates inline
// from the single-source partials in skills.ts (canvas/document/exemplar, all
// visual-plan only). The wireframe-quality core is NO LONGER inline — it lives
// in a sibling `references/wireframe.md` file shipped by every skill that sets
// `wireframeReference: true` (progressive disclosure); a separate guard asserts
// those reference files are byte-identical to the canonical constant.
const PLAN_SKILLS = [
  {
    label: "visual-plan",
    constant: VISUAL_PLANS_SKILL_MD,
    templateDir: "visual-plan",
    exportedDir: "visual-plans",
    cores: ["canvas-surface", "document-quality", "exemplar"],
    wireframeReference: true,
  },
  {
    label: "visual-recap",
    constant: VISUAL_RECAP_SKILL_MD,
    templateDir: "visual-recap",
    exportedDir: "visual-recap",
    cores: [],
    wireframeReference: true,
  },
] as const;

function templatePath(dir: string, file = "SKILL.md"): string {
  return path.join(ROOT, "templates", "plan", ".agents", "skills", dir, file);
}

function exportedPath(dir: string, file = "SKILL.md"): string {
  return path.join(ROOT, "skills", dir, file);
}

function repoSkillPath(dir: string, file = "SKILL.md"): string {
  return path.join(ROOT, ".agents", "skills", dir, file);
}

const WIREFRAME_REFERENCE_REL = path.join("references", "wireframe.md");

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

  it("keeps each inline shared core byte-identical across the skills that consume it", () => {
    // Each marker is single-sourced from one partial in skills.ts and
    // interpolated inline into its consumers. The canvas/document/exemplar cores
    // are visual-plan only. `wireframe-quality` is intentionally absent: it was
    // moved out of the inline bodies into references/wireframe.md (guarded
    // separately below), so it must NOT appear as an inline SHARED-CORE region.
    const coreMarkers = [
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

  it("ships references/wireframe.md byte-identical across every skill copy and equal to the canonical constant", () => {
    // The wireframe-quality core is single-sourced as WIREFRAME_REFERENCE_MD and
    // materialized verbatim into a sibling references/wireframe.md in every plan
    // skill dir (skills/, templates/plan/.agents/skills/, .agents/skills/). All
    // copies must match the constant byte for byte so the reference never drifts.
    const references: string[] = [];
    for (const skill of PLAN_SKILLS.filter((s) => s.wireframeReference)) {
      const copies = [
        templatePath(skill.templateDir, WIREFRAME_REFERENCE_REL),
        exportedPath(skill.exportedDir, WIREFRAME_REFERENCE_REL),
        repoSkillPath(skill.label, WIREFRAME_REFERENCE_REL),
      ];
      for (const file of copies) {
        const body = read(file);
        expect(body, `${file}: reference vs constant`).toBe(
          WIREFRAME_REFERENCE_MD,
        );
        references.push(body);
      }
    }
    // Cross-skill: every reference file is identical (visual-plan === visual-recap).
    for (const body of references) {
      expect(body).toBe(references[0]);
    }
    // The canonical reference must still embed the wireframe-quality core region
    // so the bar itself is preserved, just relocated out of the SKILL.md body.
    expect(WIREFRAME_REFERENCE_MD).toContain(
      "<!-- SHARED-CORE:wireframe-quality START -->",
    );
    expect(WIREFRAME_REFERENCE_MD).toContain(
      "<!-- SHARED-CORE:wireframe-quality END -->",
    );
  });

  it("leans the SKILL.md bodies to a wireframe.md pointer instead of the inline core", () => {
    for (const skill of PLAN_SKILLS.filter((s) => s.wireframeReference)) {
      // Body points at the reference file...
      expect(
        skill.constant,
        `${skill.label}: SKILL.md must point at references/wireframe.md`,
      ).toContain("references/wireframe.md");
      // ...and no longer inlines the full wireframe-quality core.
      expect(
        skill.constant.includes("<!-- SHARED-CORE:wireframe-quality START -->"),
        `${skill.label}: SKILL.md still inlines the wireframe-quality core`,
      ).toBe(false);
      expect(
        skill.constant.includes(
          "**A wireframe is an HTML mockup. The renderer owns the look",
        ),
        `${skill.label}: SKILL.md still inlines wireframe-quality prose`,
      ).toBe(false);
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
