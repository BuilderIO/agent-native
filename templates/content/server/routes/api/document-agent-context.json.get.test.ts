import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDocumentContextPath = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockGetRequestURL = vi.hoisted(() => vi.fn());
const { document } = vi.hoisted(() => ({
  document: {
    id: "child-page",
    parentId: "parent-page",
    title: "Child page",
    description: "What belongs in the child.",
    content: "Body",
    icon: null,
    visibility: "public",
    updatedAt: "2026-07-14T00:00:00.000Z",
    createdAt: "2026-07-14T00:00:00.000Z",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getConfiguredAppBasePath: () => "/content",
  verifyScopedAgentAccessToken: () => ({ ok: false }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  isNull: (...args: unknown[]) => args,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  getRequestURL: (...args: unknown[]) => mockGetRequestURL(...args),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("../../../shared/agent-readable.js", () => ({
  DOCUMENT_AGENT_RESOURCE_KIND: "document",
  buildContentPublicDocumentUrl: (id: string) => `/p/${id}`,
  buildContentDocumentMcpGuidance: (
    id: string,
    options: { basePath?: string; origin?: string },
  ) => ({
    preferredTransport: "mcp",
    mcpUrl: `${options.origin}${options.basePath}/mcp`,
    mcpConnectUrl: `${options.origin}${options.basePath}/mcp/connect`,
    readAction: { name: "get-document", arguments: { id } },
    whenToolUnavailable: {
      action: "tell-user-to-connect",
      connectionUrl: `${options.origin}${options.basePath}/mcp/connect`,
      message: `Connect at ${options.origin}${options.basePath}/mcp/connect`,
    },
    prohibitedFallbacks: [
      "ask-user-to-paste-document",
      "ask-user-to-make-document-public",
      "ask-user-to-change-sharing",
    ],
    instructions: "Use authenticated Content MCP.",
  }),
}));

vi.mock("../../db/index.js", () => {
  const documents = Object.fromEntries(
    Object.keys(document).map((key) => [key, `documents.${key}`]),
  );
  return {
    schema: { documents },
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [document],
          }),
        }),
      }),
    }),
  };
});

vi.mock("../../lib/document-context.js", () => ({
  getDocumentContextPath: (...args: unknown[]) =>
    mockGetDocumentContextPath(...args),
}));

import handler from "./document-agent-context.json.get";

describe("GET /api/document-agent-context.json", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    document.visibility = "public";
    mockGetQuery.mockReturnValue({ id: document.id });
    mockGetRequestURL.mockReturnValue(
      new URL("https://content.example.test/api/document-agent-context.json"),
    );
    mockGetDocumentContextPath.mockResolvedValue([
      {
        id: "parent-page",
        kind: "page",
        title: "Parent page",
        description: "What belongs in the parent.",
      },
    ]);
  });

  it("includes inherited ancestry context without copying it into the document", async () => {
    const result = await handler({} as never);

    expect(mockGetDocumentContextPath).toHaveBeenCalledWith(document);
    expect(result).toMatchObject({
      id: document.id,
      description: document.description,
      contextPath: [
        {
          id: "parent-page",
          description: "What belongs in the parent.",
        },
      ],
    });
  });

  it("directs anonymous private reads to authenticated Content MCP", async () => {
    document.visibility = "private";

    const result = await handler({} as never);

    expect(result).toMatchObject({
      error: "This private document is not readable through anonymous HTTP",
      resourceType: "document",
      resourceId: document.id,
      preferredTransport: "mcp",
      mcpUrl: "https://content.example.test/content/mcp",
      mcpConnectUrl: "https://content.example.test/content/mcp/connect",
      readAction: { name: "get-document", arguments: { id: document.id } },
      whenToolUnavailable: {
        action: "tell-user-to-connect",
        connectionUrl: "https://content.example.test/content/mcp/connect",
      },
    });
  });

  it("distinguishes a rejected agent token without echoing it", async () => {
    document.visibility = "private";
    mockGetQuery.mockReturnValue({
      id: document.id,
      agent_access: "rejected-token",
    });

    const result = await handler({} as never);

    expect(result).toMatchObject({
      error: "The agent access token is invalid or expired",
      resourceId: document.id,
      preferredTransport: "mcp",
    });
    expect(JSON.stringify(result)).not.toContain("rejected-token");
  });
});
