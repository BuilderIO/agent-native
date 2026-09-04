import { describe, expect, it } from "vitest";

import {
  localControlResourceNamespace,
  localControlResourceWrites,
} from "./local-control-resources";

describe("local control resources", () => {
  it("maps selected folder control files into instruction and skill resources", () => {
    const writes = localControlResourceWrites({
      folderName: "Plan Workspace",
      files: {
        "AGENTS.md": "Use plan instructions.",
        "mcp.config.json": '{ "servers": {} }',
        ".agents/skills/research/SKILL.md": "# Research",
      },
    });

    expect(writes).toEqual([
      {
        path: "skills/plan-workspace-research/SKILL.md",
        content: "# Research",
        sourcePath: ".agents/skills/research/SKILL.md",
      },
      {
        path: "instructions/local-files/plan-workspace/AGENTS.md",
        content: "Use plan instructions.",
        sourcePath: "AGENTS.md",
      },
      {
        path: "instructions/local-files/plan-workspace/mcp.config.json.md",
        content: '# mcp.config.json\n\n```json\n{ "servers": {} }\n```\n',
        sourcePath: "mcp.config.json",
      },
    ]);
  });

  it("uses the persisted folder id when namespacing selected codebase resources", () => {
    const writes = localControlResourceWrites({
      folderId: "plan-workspace-a1b2c3d4",
      folderName: "Plan Workspace",
      files: {
        "AGENTS.md": "Use plan instructions.",
        ".agents/skills/research/SKILL.md": "# Research",
      },
    });

    expect(
      localControlResourceNamespace({
        folderId: "plan-workspace-a1b2c3d4",
        folderName: "Plan Workspace",
      }),
    ).toBe("plan-workspace-a1b2c3d4");
    expect(writes.map((write) => write.path)).toEqual([
      "skills/plan-workspace-a1b2c3d4-research/SKILL.md",
      "instructions/local-files/plan-workspace-a1b2c3d4/AGENTS.md",
    ]);
  });
});
