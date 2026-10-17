import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createAgentChatPlugin: vi.fn((options: Record<string, unknown>) => options),
  documentChatStartVersionId: vi.fn(),
  flushOpenDocumentEditorToSql: vi.fn(),
  getDb: vi.fn(),
  loadActionsFromStaticRegistry: vi.fn(() => ({})),
  recordDocumentHistoryTransition: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  createAgentChatPlugin: mocks.createAgentChatPlugin,
  loadActionsFromStaticRegistry: mocks.loadActionsFromStaticRegistry,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: mocks.assertAccess,
}));

vi.mock("../../actions/_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: mocks.flushOpenDocumentEditorToSql,
}));

vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: mocks.getDb,
}));

vi.mock("../lib/document-history.js", () => ({
  documentChatStartVersionId: mocks.documentChatStartVersionId,
  recordDocumentHistoryTransition: mocks.recordDocumentHistoryTransition,
}));

vi.mock("../../.generated/actions-registry.js", () => ({
  default: {},
}));

vi.mock("../lib/public-documents.js", () => ({
  publicDocumentExtraContext: vi.fn(),
  resolvePublicViewerOwner: vi.fn(),
}));

describe("Content agent chat plugin", () => {
  it("opts delegated work into the durable background run contract", async () => {
    await import("./agent-chat.js");

    expect(mocks.createAgentChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "content",
        durableBackgroundRuns: true,
      }),
    );
  });

  it("tells the agent to reuse bounded screen context before rereading it", async () => {
    await import("./agent-chat.js");

    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      systemPrompt?: string;
    };

    expect(options.systemPrompt).toContain(
      "The current screen is already included as bounded context",
    );
    expect(options.systemPrompt).toContain(
      "Do not call view-screen at the start of a turn or repeatedly",
    );
  });

  it("keeps Content-owned MCP membership on actions and explicitly allowlists writes", async () => {
    await import("./agent-chat.js");

    expect(mocks.createAgentChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "content",
        mcp: expect.objectContaining({
          externalAgents: { writes: "allowlisted" },
        }),
      }),
    );
  });

  it("keeps only injected tools in the centralized starter list", async () => {
    await import("./agent-chat.js");

    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      initialToolNames?: string[];
    };

    expect(options.initialToolNames).toEqual([
      "provider-api-catalog",
      "provider-api-docs",
      "provider-api-request",
      "query-staged-dataset",
    ]);
    expect(options.initialToolNames).not.toContain("create-document");
  });

  it("keeps selected Content receivers local without rollout plumbing", async () => {
    await import("./agent-chat.js");

    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0];
    expect(options).toHaveProperty("selectedA2AReceiverOwnsObjective", true);
    expect(options).not.toHaveProperty("a2aReceiverOwnershipFlag");
  });

  it("flushes the live editor before recording the chat-start version", async () => {
    const order: string[] = [];
    let accessCount = 0;
    mocks.assertAccess.mockImplementation(async () => {
      order.push("read");
      accessCount += 1;
      return {
        resource: {
          ownerEmail: "owner@example.com",
          title: "Draft",
          content: accessCount === 1 ? "before flush" : "latest edit",
        },
      };
    });
    mocks.flushOpenDocumentEditorToSql.mockImplementation(async () => {
      order.push("flush");
    });
    mocks.documentChatStartVersionId.mockReturnValue("start-version");
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    mocks.recordDocumentHistoryTransition.mockImplementation(async () => {
      order.push("record");
    });

    await import("./agent-chat.js");
    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      onAgentTurnStart?: (
        scope: { type: string; id: string },
        run: { threadId: string; runId: string },
      ) => Promise<void>;
    };

    await options.onAgentTurnStart?.(
      { type: "document", id: "document-1" },
      { threadId: "thread-1", runId: "run-1" },
    );

    expect(order).toEqual(["read", "flush", "read", "record"]);
    expect(mocks.flushOpenDocumentEditorToSql).toHaveBeenCalledWith({
      documentId: "document-1",
      ownerEmail: "owner@example.com",
    });
    expect(mocks.recordDocumentHistoryTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { title: "Draft", content: "latest edit" },
        after: { title: "Draft", content: "latest edit" },
      }),
    );
  });
});
