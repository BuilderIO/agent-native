import { describe, expect, it } from "vitest";
import {
  withAgentScratchFolder,
  withMcpServersFolder,
  type TreeNode,
} from "./use-resources.js";

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

describe("withMcpServersFolder", () => {
  it("adds built-in capabilities to the MCP folder", () => {
    const result = withMcpServersFolder([], [], {
      builtins: [
        {
          scope: "user",
          capability: {
            id: "browser-chrome-devtools",
            serverId: "chrome-devtools",
            name: "Chrome DevTools",
            description: "Attach to Chrome.",
            command: "npx",
            args: ["-y", "chrome-devtools-mcp@0.26.0"],
            exclusiveGroup: "browser",
            available: true,
            enabled: { user: false, org: false },
            mergedIds: {},
            status: {},
          },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("mcp-servers");
    expect(result[0].children?.[0].kind).toBe("mcp-builtin");
    expect(result[0].children?.[0].resource?.id).toBe(
      "mcp-builtin:user:browser-chrome-devtools",
    );
  });
});
