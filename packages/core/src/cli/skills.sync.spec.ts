import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANVAS_REFERENCE_MD,
  CONNECTION_REFERENCE_MD,
  DOCUMENT_QUALITY_REFERENCE_MD,
  EXEMPLAR_REFERENCE_MD,
  LOCAL_FILES_REFERENCE_MD,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  VISUALIZE_REPO_SKILL_MD,
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
// from the single-source partials in skills.ts. None remain: the wireframe,
// canvas, document-quality, and exemplar cores were ALL moved out of the inline
// bodies into sibling `references/*.md` files (progressive disclosure).
// `references` lists those files: each is single-sourced as a `*_REFERENCE_MD`
// constant and a separate guard asserts every on-disk copy is byte-identical to
// it. The wireframe reference is shipped by both plan skills; the canvas /
// document-quality / exemplar references are visual-plan only.
const PLAN_SKILLS = [
  {
    label: "visual-plan",
    constant: VISUAL_PLANS_SKILL_MD,
    templateDir: "visual-plan",
    exportedDir: "visual-plans",
    references: [
      {
        rel: "references/wireframe.md",
        constant: WIREFRAME_REFERENCE_MD,
        marker: "wireframe-quality",
        sharedAcrossSkills: true,
      },
      {
        rel: "references/canvas.md",
        constant: CANVAS_REFERENCE_MD,
        marker: "canvas-surface",
      },
      {
        rel: "references/document-quality.md",
        constant: DOCUMENT_QUALITY_REFERENCE_MD,
        marker: "document-quality",
      },
      {
        rel: "references/exemplar.md",
        constant: EXEMPLAR_REFERENCE_MD,
        marker: "exemplar",
      },
      {
        rel: "references/connection.md",
        constant: CONNECTION_REFERENCE_MD,
        marker: "connection",
        sharedAcrossSkills: true,
      },
      {
        rel: "references/local-files.md",
        constant: LOCAL_FILES_REFERENCE_MD,
        marker: "local-files",
        sharedAcrossSkills: true,
      },
    ],
  },
  {
    label: "visual-recap",
    constant: VISUAL_RECAP_SKILL_MD,
    templateDir: "visual-recap",
    exportedDir: "visual-recap",
    references: [
      {
        rel: "references/wireframe.md",
        constant: WIREFRAME_REFERENCE_MD,
        marker: "wireframe-quality",
        sharedAcrossSkills: true,
      },
      {
        rel: "references/connection.md",
        constant: CONNECTION_REFERENCE_MD,
        marker: "connection",
        sharedAcrossSkills: true,
      },
      {
        rel: "references/local-files.md",
        constant: LOCAL_FILES_REFERENCE_MD,
        marker: "local-files",
        sharedAcrossSkills: true,
      },
    ],
  },
  {
    label: "visualize-repo",
    constant: VISUALIZE_REPO_SKILL_MD,
    templateDir: "visualize-repo",
    exportedDir: "visualize-repo",
    references: [],
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

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
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

  it("never inlines a relocated core (wireframe/canvas/document-quality/exemplar) in any SKILL.md body", () => {
    // These four cores live only in references/*.md now. None may reappear as an
    // inline SHARED-CORE region in any SKILL.md, or the single source of truth
    // (the reference file) would silently fork.
    const relocated = [
      "wireframe-quality",
      "canvas-surface",
      "document-quality",
      "exemplar",
    ] as const;
    for (const skill of PLAN_SKILLS) {
      for (const marker of relocated) {
        expect(
          skill.constant.includes(`<!-- SHARED-CORE:${marker} START -->`),
          `${skill.label}: SKILL.md still inlines the relocated core "${marker}"`,
        ).toBe(false);
      }
    }
  });

  it("ships every references/*.md byte-identical across each skill copy and equal to its canonical constant", () => {
    // Each reference is single-sourced as a `*_REFERENCE_MD` constant and
    // materialized verbatim into a sibling references/*.md in every plan skill
    // dir (skills/, templates/plan/.agents/skills/, .agents/skills/). All copies
    // must match the constant byte for byte so the reference never drifts.
    for (const skill of PLAN_SKILLS) {
      for (const ref of skill.references) {
        const copies = [
          templatePath(skill.templateDir, ref.rel),
          exportedPath(skill.exportedDir, ref.rel),
          repoSkillPath(skill.label, ref.rel),
        ];
        for (const file of copies) {
          expect(read(file), `${file}: reference vs constant`).toBe(
            ref.constant,
          );
        }
      }
    }
    // Cross-skill: each reference flagged `sharedAcrossSkills` must be identical
    // everywhere it ships (wireframe / connection / local-files on both
    // visual-plan and visual-recap). Group by the reference path so distinct
    // shared references are only compared against their own copies.
    const sharedByRel = new Map<string, string[]>();
    for (const skill of PLAN_SKILLS) {
      for (const ref of skill.references) {
        if (!ref.sharedAcrossSkills) continue;
        const body = read(exportedPath(skill.exportedDir, ref.rel));
        const bodies = sharedByRel.get(ref.rel) ?? [];
        bodies.push(body);
        sharedByRel.set(ref.rel, bodies);
      }
    }
    for (const [rel, bodies] of sharedByRel) {
      for (const body of bodies) {
        expect(body, `${rel}: shared reference differs across skills`).toBe(
          bodies[0],
        );
      }
    }
    // The canonical references must still embed their SHARED-CORE marker regions
    // so the bar itself is preserved, just relocated out of the SKILL.md body.
    for (const skill of PLAN_SKILLS) {
      for (const ref of skill.references) {
        expect(ref.constant).toContain(
          `<!-- SHARED-CORE:${ref.marker} START -->`,
        );
        expect(ref.constant).toContain(
          `<!-- SHARED-CORE:${ref.marker} END -->`,
        );
      }
    }
  });

  it("leans the SKILL.md bodies to references/*.md pointers instead of inline cores", () => {
    for (const skill of PLAN_SKILLS) {
      // Body points at each reference file it ships...
      for (const ref of skill.references) {
        expect(
          skill.constant,
          `${skill.label}: SKILL.md must point at ${ref.rel}`,
        ).toContain(ref.rel);
      }
    }
    // ...and the visual-plan body no longer inlines the relocated core prose.
    const visualPlan = PLAN_SKILLS.find((s) => s.label === "visual-plan");
    expect(visualPlan, "visual-plan skill missing").toBeDefined();
    expect(
      visualPlan!.constant.includes(
        "**A wireframe is an HTML mockup. The renderer owns the look",
      ),
      "visual-plan: SKILL.md still inlines wireframe-quality prose",
    ).toBe(false);
    expect(
      visualPlan!.constant.includes("**Artboard placement is locked by the"),
      "visual-plan: SKILL.md still inlines canvas-surface prose",
    ).toBe(false);
    expect(
      visualPlan!.constant.includes(
        "**The document is a serious technical plan, not marketing.",
      ),
      "visual-plan: SKILL.md still inlines document-quality prose",
    ).toBe(false);
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
    expect(VISUALIZE_REPO_SKILL_MD).toMatch(/^---\nname: visualize-repo\n/);
    expect(VISUALIZE_REPO_SKILL_MD).toContain("`/visualize-repo`");
  });
});
