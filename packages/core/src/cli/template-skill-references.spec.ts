import { describe, expect, it } from "vitest";

import {
  missingInstructionSkillReferences,
  skillNamesFromInstructions,
} from "./template-skill-references.js";

describe("template instruction skill references", () => {
  it("collects listed skills and explicit skill paths without treating actions as skills", () => {
    const instructions = [
      "## Skills",
      "",
      "This scaffold ships `actions` and `domain-guide`.",
      "",
      "- `local-guide`, `second-guide` — use for local workflows.",
      "- `mail-workflow` — reads `get-mail-settings` before sending.",
      "",
      "Read `customizing-agent-native` skill before replacing the shared shell.",
      "See `workspace/multi-app-workspace` for workspace docs.",
      "Read `.agents/skills/embedded-guide/SKILL.md` for app-specific rules.",
      "",
      "## Framework Docs",
      "",
      "See `not-a-skill` for a docs page.",
    ].join("\n");

    expect(skillNamesFromInstructions(instructions)).toEqual([
      "actions",
      "customizing-agent-native",
      "domain-guide",
      "embedded-guide",
      "local-guide",
      "mail-workflow",
      "second-guide",
    ]);
  });

  it("reports listed skill names missing from a scaffold", () => {
    const instructions = [
      "## Skills",
      "",
      "- `present-skill` — available locally.",
      "- `missing-skill` — referenced by this scaffold.",
    ].join("\n");

    expect(
      missingInstructionSkillReferences(instructions, ["present-skill"]),
    ).toEqual(["missing-skill"]);
  });

  it("catches plain references to known skills outside the Skills section", () => {
    const instructions = [
      "## Core Rules",
      "See `workspace-conventions` if this becomes a multi-app workspace.",
    ].join("\n");

    expect(
      missingInstructionSkillReferences(
        instructions,
        ["actions"],
        ["actions", "workspace-conventions"],
      ),
    ).toEqual(["workspace-conventions"]);
  });

  it("does not treat docs slugs, routes, or action names as skill references", () => {
    const instructions = [
      "## Framework Docs Lookup",
      "Read `pnpm action docs-search --slug extensions` for docs.",
      "Start with `actions`, `automations`, and `external-agents`.",
      "## Application State",
      "The `extensions` route shows saved app extensions.",
      "## Actions",
      "| `visual-answer` | Explain a visual plan |",
    ].join("\n");

    expect(
      missingInstructionSkillReferences(
        instructions,
        ["actions"],
        [
          "actions",
          "automations",
          "external-agents",
          "extensions",
          "visual-answer",
        ],
      ),
    ).toEqual([]);
  });
});
