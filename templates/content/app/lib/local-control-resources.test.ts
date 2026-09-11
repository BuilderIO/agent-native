import { describe, expect, it } from "vitest";

import { localControlResourceWrites } from "./local-control-resources";

describe("local control resources", () => {
  it("maps root instructions, JSON configs, and skill files into auto-loaded resources", () => {
    const writes = localControlResourceWrites({
      folderName: "My Repo",
      files: {
        "AGENTS.md": "Use repo instructions.",
        "agent-native.json": '{ "name": "repo" }',
        "mcp.config.json": '{ "servers": {} }',
        ".mcp.json": '{ "mcpServers": {} }',
        ".agents/skills/Code Review/SKILL.md": "---\nname: review\n---",
        ".agents/skills/Code Review/references/checklist.md": "Checklist",
        ".agent/skills/Deploy/SKILL.md": "# Deploy",
      },
    });

    expect(writes.map((write) => write.path)).toEqual([
      "skills/my-repo-deploy/SKILL.md",
      "skills/my-repo-code-review/references/checklist.md",
      "skills/my-repo-code-review/SKILL.md",
      "instructions/local-files/my-repo/.mcp.json.md",
      "instructions/local-files/my-repo/agent-native.json.md",
      "instructions/local-files/my-repo/AGENTS.md",
      "instructions/local-files/my-repo/mcp.config.json.md",
    ]);
    expect(
      writes.find(
        (write) =>
          write.path ===
          "instructions/local-files/my-repo/agent-native.json.md",
      )?.content,
    ).toBe('# agent-native.json\n\n```json\n{ "name": "repo" }\n```\n');
    expect(
      writes.find(
        (write) => write.path === "skills/my-repo-code-review/SKILL.md",
      )?.content,
    ).toBe("---\nname: review\n---");
  });

  it("ignores unsafe paths and never maps to personal AGENTS.md", () => {
    const writes = localControlResourceWrites({
      folderName: "../Repo",
      files: {
        "../AGENTS.md": "bad",
        "nested/AGENTS.md": "ignored",
        "AGENTS.md": "root",
      },
    });

    expect(writes).toEqual([
      {
        path: "instructions/local-files/repo/AGENTS.md",
        content: "root",
        sourcePath: "AGENTS.md",
      },
    ]);
  });
});
