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
});
