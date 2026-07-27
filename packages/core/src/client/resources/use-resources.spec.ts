import { describe, expect, it } from "vitest";

import type { BuiltinCapability } from "./use-builtin-capabilities.js";
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

  it("groups top-level scratch folders with agent scratch when show is true", () => {
    const tree: TreeNode[] = [
      fileNode("AGENTS.md"),
      {
        name: "scratch",
        path: "scratch",
        type: "folder",
        children: [fileNode("scratch/raw.json", "agent_scratch")],
      },
    ];

    const result = withAgentScratchFolder(tree, { show: true });

    expect(result.map((node) => node.name)).toEqual([
      "agent-scratch",
      "AGENTS.md",
    ]);
    expect(result[0].children?.[0].name).toBe("scratch");
  });
});

describe("withMcpServersFolder", () => {
  it("adds configured MCP servers to the MCP folder", () => {
    const result = withMcpServersFolder(
      [],
      [
        {
          id: "zapier",
          scope: "user",
          name: "Zapier",
          url: "https://mcp.zapier.example/mcp",
          createdAt: 123,
          mergedId: "user_hash_zapier",
          status: { state: "unknown" },
        },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("mcp-servers");
    expect(result[0].children?.[0].kind).toBe("mcp-server");
    expect(result[0].children?.[0].resource?.id).toBe("mcp:user:zapier");
  });

  it("adds built-in MCP capabilities to the MCP folder", () => {
    const capability: BuiltinCapability = {
      id: "browser-playwright",
      serverId: "builtin-browser-playwright",
      name: "Browser",
      description: "Control a local browser for QA.",
      command: "npx",
      args: ["playwright-mcp"],
      exclusiveGroup: "browser",
      available: true,
      enabled: { user: true, org: false },
      mergedIds: { user: "user_builtin_browser" },
      status: { user: { state: "connected", toolCount: 9 } },
    };

    const result = withMcpServersFolder([], [], {
      builtins: [{ capability, scope: "user" }],
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("mcp-servers");
    expect(result[0].children?.[0].kind).toBe("mcp-builtin");
    expect(result[0].children?.[0].mcpBuiltinMeta?.scopeEnabled).toBe(true);
    expect(result[0].children?.[0].resource?.id).toBe(
      "mcp-builtin:user:browser-playwright",
    );
  });
});
