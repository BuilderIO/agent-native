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
        accessState: "authentication-required",
      }),
    ).toEqual({
      type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
      resourceType: "document",
      resourceId: "doc 1",
      title: "Launch notes",
      url: "/content/p/doc 1?agent_access=tok%2B1",
      contextUrl:
        "/content/api/document-agent-context.json?id=doc+1&agent_access=tok%2B1",
      instructions: expect.stringContaining("This Content document is private"),
      accessContractVersion: 2,
      preferredTransport: "mcp",
      mcpUrl: "https://content.example.test/content/mcp",
      mcpConnectUrl: "https://content.example.test/content/mcp/connect",
      readAction: {
        name: "get-document",
        arguments: { id: "doc 1" },
      },
      access: {
        state: "authentication-required",
        summary:
          "This Content document is private. Authenticated access is available through the Content MCP integration.",
        sharePageAuthenticationRequired: true,
        sharePageHttpAccess: "denied",
        sharePageAuthorization: "none",
        mcpActionAuthenticationRequired: true,
        mcpConnectionRequiredForPageAccess: true,
        mcpAccountPermission: "not-evaluated",
        mcpAuthorization: "connected-account-existing-permissions",
        setupDocumentationUrl:
          "https://www.agent-native.com/docs/external-agents/#private-content-links",
        connectionUrl: "https://content.example.test/content/mcp/connect",
        missingMcpConnectionPath:
          "add-remote-server-authenticate-enable-and-retry",
      },
    });
  });

  it("describes private access factually with official and instance-specific setup links", () => {
    const guidance = buildContentDocumentMcpGuidance("doc-1", {
      basePath: "/content",
      origin: "https://content.example.test",
    });

    expect(guidance.access).toEqual({
      state: "authentication-required",
      summary:
        "This Content document is private. Authenticated access is available through the Content MCP integration.",
      sharePageAuthenticationRequired: true,
      sharePageHttpAccess: "denied",
      sharePageAuthorization: "none",
      mcpActionAuthenticationRequired: true,
      mcpConnectionRequiredForPageAccess: true,
      mcpAccountPermission: "not-evaluated",
      mcpAuthorization: "connected-account-existing-permissions",
      setupDocumentationUrl:
        "https://www.agent-native.com/docs/external-agents/#private-content-links",
      connectionUrl: "https://content.example.test/content/mcp/connect",
      missingMcpConnectionPath:
        "add-remote-server-authenticate-enable-and-retry",
    });
    expect(guidance.instructions).toContain("Content access information:");
    expect(guidance.instructions).toContain(
      "https://www.agent-native.com/docs/external-agents/#private-content-links",
    );
    expect(guidance.instructions).toContain(
      "Document access through MCP uses the connected account's existing permissions",
    );
    expect(guidance.instructions).toContain(
      "connected account's document permission has not been evaluated",
    );
    expect(guidance.instructions).toContain(
      "add this instance as a remote MCP server, authenticate, enable the connection or its tools, and retry",
    );
    expect(guidance.instructions).toContain(
      "does not distinguish missing permission from a stale, deleted, or invalid document id",
    );
    expect(guidance.instructions).not.toContain("tell the user");
    expect(guidance.instructions).not.toContain("Do not ask");
  });

  it("does not describe a public share page as requiring authentication", () => {
    const guidance = buildContentDocumentMcpGuidance("doc-1", {
      origin: "https://content.example.test",
      accessState: "public",
    });

    expect(guidance.access.sharePageAuthenticationRequired).toBe(false);
    expect(guidance.access.sharePageAuthorization).toBe("public");
    expect(guidance.access.mcpConnectionRequiredForPageAccess).toBe(false);
    expect(guidance.access.mcpActionAuthenticationRequired).toBe(true);
    expect(guidance.access.state).toBe("public");
    expect(guidance.instructions).toContain(
      "available through its public Content share page",
    );
    expect(guidance.instructions).not.toContain("document is private");
    expect(guidance.instructions).toContain(
      "This public share page does not require an MCP account permission",
    );
    expect(guidance.instructions).not.toContain(
      "connected account's existing permissions",
    );
  });

  it("preserves authorized tokenized-share discovery", () => {
    const discovery = buildContentDocumentAgentDiscovery({
      document: { id: "doc-1", title: "Private notes" },
      origin: "https://content.example.test",
      token: "share-token",
      accessState: "authorized",
    });

    expect(discovery.access).toMatchObject({
      state: "authorized",
      sharePageHttpAccess: "authorized",
      sharePageAuthenticationRequired: false,
      sharePageAuthorization: "scoped-token",
      mcpActionAuthenticationRequired: true,
      mcpConnectionRequiredForPageAccess: false,
      mcpAccountPermission: "not-evaluated",
    });
    expect(discovery.accessContractVersion).toBe(2);
    expect(discovery.instructions).toContain(
      "This page is authorized by its scoped share token",
    );
    expect(discovery.instructions).toContain(
      "MCP access separately uses the connected account's existing document permissions",
    );
    expect(discovery.url).toContain("agent_access=share-token");
    expect(discovery.contextUrl).toContain("agent_access=share-token");
  });

  it("names the MCP action argument consistently in prose and structured guidance", () => {
    const guidance = buildContentDocumentMcpGuidance("doc-1");

    expect(guidance.readAction.arguments).toEqual({ id: "doc-1" });
    expect(guidance.instructions).toContain("get-document with id");
    expect(guidance.instructions).not.toContain("get-document with resourceId");
  });
});
