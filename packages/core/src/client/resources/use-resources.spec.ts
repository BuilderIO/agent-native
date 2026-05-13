import { describe, expect, it } from "vitest";
import { withAgentScratchFolder, type TreeNode } from "./use-resources.js";

function fileNode(
  path: string,
  visibility: "workspace" | "agent_scratch" = "workspace",
): TreeNode {
  const name = path.split("/").pop() ?? path;
  return {
    name,
    path,
    type: "file",
    resource: {
      id: path,
      path,
      owner: "user@test.com",
      mimeType: "text/markdown",
      size: 1,
      createdAt: 1,
      updatedAt: 1,
      createdBy: visibility === "agent_scratch" ? "agent" : "user",
      visibility,
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: null,
    },
  };
}

describe("withAgentScratchFolder", () => {
  it("hides top-level scratch folders when show is false", () => {
    const tree: TreeNode[] = [
      fileNode("AGENTS.md"),
      {
        name: "scripts",
        path: "scripts",
        type: "folder",
        children: [fileNode("scripts/tmp.ts")],
      },
    ];

    expect(withAgentScratchFolder(tree, { show: false })).toEqual([
      fileNode("AGENTS.md"),
    ]);
  });

  it("groups agent scratch resources when show is true", () => {
    const tree: TreeNode[] = [
      fileNode("AGENTS.md"),
      fileNode("analysis.tmp.md", "agent_scratch"),
    ];

    const result = withAgentScratchFolder(tree, { show: true });

    expect(result.map((node) => node.name)).toEqual([
      "agent-scratch",
      "AGENTS.md",
    ]);
    expect(result[0].children?.[0].name).toBe("analysis.tmp.md");
  });
});
