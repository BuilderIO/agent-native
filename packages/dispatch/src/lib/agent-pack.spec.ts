import { isActionContractError } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import {
  AGENT_PACK_FILE_ACCEPT,
  AGENT_PROFILE_FILE_ACCEPT,
  agentPackRoot,
  isImportableAgentPackFile,
  isImportableAgentProfileFile,
  normalizeAgentPack,
} from "./agent-pack.js";

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

  it("rejects a pack file the import logic cannot read as text", () => {
    expect(() =>
      normalizeAgentPack([
        { path: "agent.md", content: "# Agent" },
        { path: "references/6a42e3ab (1).pdf", content: "%PDF-1.4 ..." },
      ]),
    ).toThrow("only accept text files");
  });
});

describe("importable agent file types", () => {
  it("accepts the profile formats the single-file import can parse", () => {
    for (const path of [
      "agent.md",
      "AGENT.MARKDOWN",
      "agent.json",
      "notes.txt",
    ]) {
      expect(isImportableAgentProfileFile(path)).toBe(true);
    }
    for (const path of ["scan (1).pdf", "logo.png", "agent.yaml", "agent"]) {
      expect(isImportableAgentProfileFile(path)).toBe(false);
    }
  });

  it("accepts the wider text set a folder import keeps", () => {
    for (const path of [
      "skills/interviews/SKILL.md",
      "context/config.yaml",
      "scripts/run.sh",
      "src/index.tsx",
    ]) {
      expect(isImportableAgentPackFile(path)).toBe(true);
    }
    for (const path of [
      "references/6a42e3ab (1).pdf",
      "assets/cover.png",
      "archive.zip",
    ]) {
      expect(isImportableAgentPackFile(path)).toBe(false);
    }
  });

  it("keeps the picker accept filters in step with the parsers", () => {
    expect(AGENT_PROFILE_FILE_ACCEPT).toBe(".md,.markdown,.json,.txt");
    for (const extension of AGENT_PACK_FILE_ACCEPT.split(",")) {
      expect(isImportableAgentPackFile(`example${extension}`)).toBe(true);
    }
    for (const extension of AGENT_PROFILE_FILE_ACCEPT.split(",")) {
      expect(isImportableAgentProfileFile(`example${extension}`)).toBe(true);
      expect(AGENT_PACK_FILE_ACCEPT).toContain(extension);
    }
    expect(AGENT_PROFILE_FILE_ACCEPT).not.toContain(".pdf");
    expect(AGENT_PACK_FILE_ACCEPT).not.toContain(".pdf");
  });
});
