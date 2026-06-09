import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLAN_DESIGN_SKILL_MD,
  PROTOTYPE_PLAN_SKILL_MD,
  UI_PLAN_SKILL_MD,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  VISUAL_QUESTIONS_SKILL_MD,
} from "./packages/core/src/cli/skills.ts";

const root = process.cwd();

// label = repo-local (.agents/skills), exportedDir = skills/, templateDir = templates/plan/.agents/skills
const skills = [
  {
    constant: VISUAL_PLANS_SKILL_MD,
    label: "visual-plan",
    templateDir: "visual-plan",
    exportedDir: "visual-plans",
  },
  {
    constant: VISUAL_RECAP_SKILL_MD,
    label: "visual-recap",
    templateDir: "visual-recap",
    exportedDir: "visual-recap",
  },
  {
    constant: UI_PLAN_SKILL_MD,
    label: "ui-plan",
    templateDir: "ui-plan",
    exportedDir: "ui-plan",
  },
  {
    constant: PROTOTYPE_PLAN_SKILL_MD,
    label: "prototype-plan",
    templateDir: "prototype-plan",
    exportedDir: "prototype-plan",
  },
  {
    constant: PLAN_DESIGN_SKILL_MD,
    label: "plan-design",
    templateDir: "plan-design",
    exportedDir: "plan-design",
  },
  {
    constant: VISUAL_QUESTIONS_SKILL_MD,
    label: "visual-questions",
    templateDir: "visual-questions",
    exportedDir: "visual-questions",
  },
];

for (const s of skills) {
  const paths = [
    join(root, "skills", s.exportedDir, "SKILL.md"),
    join(root, "templates", "plan", ".agents", "skills", s.templateDir, "SKILL.md"),
    join(root, ".agents", "skills", s.label, "SKILL.md"),
  ];
  for (const p of paths) {
    writeFileSync(p, s.constant, "utf-8");
  }
  console.log("synced", s.label);
}
