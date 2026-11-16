import { describe, expect, it } from "vitest";

import { isNameTaken } from "../../free-name/index.js";
import { actionErrorMessage } from "../use-action.js";
import type { BuiltinCapability } from "./use-builtin-capabilities.js";
import {
  resourceDownloadUrl,
  resourceWriteError,
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

describe("resourceDownloadUrl", () => {
  it("constructs an attachment URL without exposing the resource id as query syntax", () => {
    expect(resourceDownloadUrl("resource/with?query")).toBe(
      "/_agent-native/resources/resource%2Fwith%3Fquery?download=1",
    );
  });
});

describe("resourceWriteError", () => {
  it("keeps a refusal's message and free name", async () => {
    const error = await resourceWriteError(
      new Response(
        JSON.stringify({
          error: 'A resource named "a.md" already exists.',
          errorCode: "name_taken",
          details: { name: "a.md", suggestion: "a-2.md" },
        }),
        { status: 409, statusText: "Conflict" },
      ),
      "Update failed: Conflict",
    );
    expect(error.message).toBe('A resource named "a.md" already exists.');
    expect(actionErrorMessage(error)).toBe(error.message);
    expect(error).toMatchObject({ status: 409 });
    expect(isNameTaken(error)).toBe(true);
  });

  it("falls back when the body isn't JSON, and never shows a 5xx body", async () => {
    const plain = await resourceWriteError(
      new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
      "Update failed: Bad Gateway",
    );
    expect(plain.message).toBe("Update failed: Bad Gateway");
    expect(plain).toMatchObject({ status: 502 });

    const masked = await resourceWriteError(
      new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
      }),
      "Update failed",
    );
    expect(actionErrorMessage(masked)).toBeUndefined();
  });
});

describe("resourcePackScopeFromPanel", () => {
  it("maps panel scopes onto pack export scopes", async () => {
    const { resourcePackScopeFromPanel, resourcePackDownloadFilename } =
      await import("./use-resources.js");
    expect(resourcePackScopeFromPanel("shared")).toBe("organization");
    expect(resourcePackScopeFromPanel("all")).toBe("accessible");
    expect(resourcePackScopeFromPanel("personal")).toBe("personal");
    expect(resourcePackScopeFromPanel("workspace")).toBe("workspace");
    expect(resourcePackDownloadFilename(1_700_000_000_000)).toBe(
      "agent-resource-pack-1700000000000.json",
    );
  });
});

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
