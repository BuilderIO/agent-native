import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDocumentContextPath = vi.hoisted(() => vi.fn());
const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));
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
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../shared/agent-readable.js", () => ({
  DOCUMENT_AGENT_RESOURCE_KIND: "document",
  buildContentPublicDocumentUrl: (id: string) => `/p/${id}`,
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
            limit: async () => rows.current,
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
    mockGetQuery.mockReturnValue({ id: document.id });
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    rows.current = [document];
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

  it("uses the same 404 response for missing and inaccessible documents", async () => {
    const inaccessibleCases = [
      { rows: [], query: { id: document.id } },
      {
        rows: [{ ...document, visibility: "private" }],
        query: { id: document.id },
      },
      {
        rows: [{ ...document, visibility: "private" }],
        query: { id: document.id, agent_access: "expired-or-wrong-resource" },
      },
    ];

    const results = [];
    for (const testCase of inaccessibleCases) {
      rows.current = testCase.rows;
      mockGetQuery.mockReturnValue(testCase.query);
      results.push(await handler({} as never));
    }

    expect(results).toEqual([
      { error: "Document not found" },
      { error: "Document not found" },
      { error: "Document not found" },
    ]);
    expect(mockSetResponseStatus).toHaveBeenCalledTimes(3);
    expect(mockSetResponseStatus).toHaveBeenLastCalledWith({}, 404);
  });
});
