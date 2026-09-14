import { isActionContractError } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import { agentPackRoot, normalizeAgentPack } from "./agent-pack.js";

describe("agent packs", () => {
  it("normalizes a folder into a profile, references, and skills", () => {
    const pack = normalizeAgentPack([
      {
        path: "researcher/agent.md",
        content:
          "---\nname: Researcher\ndescription: Finds evidence\ntools: WebSearch, Bash\n---\n\n# Role\nFind evidence.",
      },
      {
        path: "researcher/context/glossary.md",
        content: "# Glossary\n\nUse citizens instead of users.",
      },
      {
        path: "researcher/skills/interviews/SKILL.md",
        content:
          "---\nname: Interviews\ndescription: Run interviews\n---\n\n# Workflow\nAsk open questions.",
      },
    ]);

    expect(pack.profile.name).toBe("Researcher");
    expect(pack.files).toEqual([
      expect.objectContaining({
        path: "context/glossary.md",
        kind: "agent-file",
      }),
      expect.objectContaining({
        path: "skills/interviews/SKILL.md",
        kind: "skill",
        name: "Interviews",
      }),
    ]);
    expect(agentPackRoot(pack.profile.slug)).toBe("agents/researcher");
  });

  it("rejects private paths and oversized packs", () => {
    expect(() =>
      normalizeAgentPack([
        { path: "agent.md", content: "# Agent" },
        { path: ".env", content: "SECRET=not-for-import" },
      ]),
    ).toThrow("ignored or private");
  });

  it("rejects a pack with no profile file as a clean validation error, not a crash", () => {
    // Reproduces the reported bug: selecting a folder containing only a CSV
    // (e.g. "Course Enrollment Form-2026-05-07.csv") and clicking "Import
    // agent pack" must surface an actionable message, not an unhandled 500.
    let caught: unknown;
    try {
      normalizeAgentPack([
        {
          path: "Course Enrollment Form-2026-05-07.csv",
          content: "name,email\nJane,jane@example.test\n",
        },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isActionContractError(caught)).toBe(true);
    expect((caught as { statusCode?: number }).statusCode).toBe(400);
    expect((caught as Error).message).toContain(
      "An agent pack needs an agent.md, CLAUDE.md, or Markdown profile file.",
    );
  });
});
