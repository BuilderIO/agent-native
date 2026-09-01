import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn((options: Record<string, unknown>) => options),
  loadActionsFromStaticRegistry: vi.fn(() => ({})),
}));

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: mocks.createAgentChatPlugin,
  loadActionsFromStaticRegistry: mocks.loadActionsFromStaticRegistry,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
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
        mcp: {
          externalAgents: { writes: "allowlisted" },
        },
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
});
