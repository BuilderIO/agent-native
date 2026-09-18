import { AGENT_READABLE_RESOURCE_PAYLOAD_TYPE } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import {
  buildContentDocumentAgentDiscovery,
  buildContentDocumentMcpGuidance,
  buildContentPublicDocumentPath,
  buildContentPublicDocumentUrl,
} from "./agent-readable";

describe("content agent-readable discovery", () => {
  it("builds public document paths without a mount prefix", () => {
    expect(buildContentPublicDocumentPath("doc-1")).toBe("/p/doc-1");
  });

  it("adds the configured app base path to public document URLs", () => {
    expect(
      buildContentPublicDocumentUrl("doc 1", { basePath: "/content/" }),
    ).toBe("/content/p/doc 1");
  });

  it("preserves agent access on base-prefixed document URLs", () => {
    expect(
      buildContentPublicDocumentUrl("doc-1", {
        basePath: "/content",
        token: "tok+1",
      }),
    ).toBe("/content/p/doc-1?agent_access=tok%2B1");
  });

  it("advertises base-prefixed public page and JSON context URLs", () => {
    expect(
      buildContentDocumentAgentDiscovery({
        document: { id: "doc 1", title: "Launch notes" },
        basePath: "/content",
        origin: "https://content.example.test",
        token: "tok+1",
      }),
    ).toEqual({
      type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
      resourceType: "document",
      resourceId: "doc 1",
      title: "Launch notes",
      url: "/content/p/doc 1?agent_access=tok%2B1",
      contextUrl:
        "/content/api/document-agent-context.json?id=doc+1&agent_access=tok%2B1",
      instructions: expect.stringContaining(
        "This private Content document requires the Content MCP server",
      ),
      preferredTransport: "mcp",
      mcpUrl: "https://content.example.test/content/mcp",
      mcpConnectUrl: "https://content.example.test/content/mcp/connect",
      readAction: {
        name: "get-document",
        arguments: { id: "doc 1" },
      },
      whenToolUnavailable: {
        action: "tell-user-to-connect",
        connectionUrl: "https://content.example.test/content/mcp/connect",
        message:
          "This private Content document requires the Content MCP server. Connect it at https://content.example.test/content/mcp/connect, authenticate, then ask me to retry.",
      },
      prohibitedFallbacks: [
        "ask-user-to-paste-document",
        "ask-user-to-make-document-public",
        "ask-user-to-change-sharing",
      ],
    });
  });

  it("gives a missing-tool agent an exact absolute handoff without sharing fallbacks", () => {
    const guidance = buildContentDocumentMcpGuidance("doc-1", {
      basePath: "/content",
      origin: "https://content.example.test",
    });

    expect(guidance.whenToolUnavailable).toEqual({
      action: "tell-user-to-connect",
      connectionUrl: "https://content.example.test/content/mcp/connect",
      message:
        "This private Content document requires the Content MCP server. Connect it at https://content.example.test/content/mcp/connect, authenticate, then ask me to retry.",
    });
    expect(guidance.instructions).toContain("tell the user exactly");
    expect(guidance.instructions).toContain("Do not ask the user to paste");
    expect(guidance.instructions).toContain("make it public");
    expect(guidance.instructions).toContain("change sharing permissions");
  });

  it("names the MCP action argument consistently in prose and structured guidance", () => {
    const guidance = buildContentDocumentMcpGuidance("doc-1");

    expect(guidance.readAction.arguments).toEqual({ id: "doc-1" });
    expect(guidance.instructions).toContain("get-document with id");
    expect(guidance.instructions).not.toContain("get-document with resourceId");
  });
});
