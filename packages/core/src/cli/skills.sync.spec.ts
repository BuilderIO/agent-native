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

function findStaleHtmlPhrasing(md: string): string[] {
  const offenders: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (!lower.includes("bespoke html") && !lower.includes("standalone html")) {
      continue;
    }
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
      for (const ref of skill.references) {
        expect(
          skill.constant,
          `${skill.label}: SKILL.md must point at ${ref.rel}`,
        ).toContain(ref.rel);
      }
    }
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
    expect(VISUAL_PLANS_SKILL_MD).toMatch(/^---\nname: visual-plan\n/);
    expect(VISUAL_PLANS_SKILL_MD).toContain("`/visual-plan`");
    expect(VISUALIZE_REPO_SKILL_MD).toMatch(/^---\nname: visualize-repo\n/);
    expect(VISUALIZE_REPO_SKILL_MD).toContain("`/visualize-repo`");
  });
});
