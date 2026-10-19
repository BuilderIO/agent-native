import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pluginConfig: undefined as Record<string, unknown> | undefined,
  assertAccess: vi.fn(async () => ({
    resource: {
      id: "deck-1",
      title: "Quarterly plan",
      data: JSON.stringify({ slides: [] }),
      ownerEmail: "owner@example.com",
    },
  })),
  createDeckVersionSnapshot: vi.fn(async () => undefined),
  createDeckChatBeginningSnapshot: vi.fn(async () => undefined),
  deckVersionChatContextFromRun: vi.fn(() => undefined),
}));

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: (config: Record<string, unknown>) => {
    mocks.pluginConfig = config;
    return config;
  },
  getRequestUserEmail: () => undefined,
  loadActionsFromStaticRegistry: () => ({}),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));
vi.mock("../../shared/client-compatibility.js", () => ({
  CLIENT_COMPATIBILITY_VERSION: "test",
}));
vi.mock("../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuthContext: vi.fn(),
}));
vi.mock("../lib/chat-attachments.js", () => ({
  prepareSlidesChatAttachments: vi.fn(),
}));
vi.mock("../lib/chatgpt-directory-tools.js", () => ({
  CHATGPT_DIRECTORY_PROFILE: {},
}));
vi.mock("../lib/deck-versions.js", () => ({
  createDeckChatBeginningSnapshot: mocks.createDeckChatBeginningSnapshot,
  createDeckVersionSnapshot: mocks.createDeckVersionSnapshot,
  deckVersionChatContextFromRun: mocks.deckVersionChatContextFromRun,
}));
vi.mock("../lib/generation-completion.js", () => ({
  readGeneratedDeckSlideCount: vi.fn(),
  trackGenerationCompletedForRun: vi.fn(),
}));
vi.mock("../register-secrets.js", () => ({}));

type AgentChatConfig = {
  onAgentTurnComplete?: (
    scope: { type: string; id: string },
    run: {
      events: unknown[];
      threadId: string;
      runId: string;
    },
  ) => Promise<void>;
};

describe("Slides 2 chat autosave", () => {
  beforeAll(async () => {
    await import("./agent-chat.js");
  });

  beforeEach(() => {
    mocks.assertAccess.mockClear();
    mocks.createDeckVersionSnapshot.mockClear();
  });

  it("autosaves a committed deck write even when its tool result is an error", async () => {
    const config = mocks.pluginConfig as AgentChatConfig | undefined;
    expect(config?.onAgentTurnComplete).toBeTypeOf("function");

    await config!.onAgentTurnComplete!(
      { type: "deck", id: "deck-1" },
      {
        threadId: "thread-1",
        runId: "run-1",
        events: [
          {
            event: {
              type: "tool_done",
              tool: "add-slide",
              input: { deckId: "deck-1" },
              isError: true,
              completedSideEffect: true,
            },
          },
        ],
      },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.createDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1" }),
      expect.objectContaining({
        force: true,
        label: "Chat autosave",
      }),
    );
  });

  it("autosaves source-backed slide edits at the end of the agent turn", async () => {
    const config = mocks.pluginConfig as AgentChatConfig | undefined;
    expect(config?.onAgentTurnComplete).toBeTypeOf("function");

    await config!.onAgentTurnComplete!(
      { type: "deck", id: "deck-1" },
      {
        threadId: "thread-1",
        runId: "run-1",
        events: [
          {
            event: {
              type: "tool_done",
              tool: "update-slide-source",
              input: { deckId: "deck-1", slideId: "slide-1" },
              completedSideEffect: true,
            },
          },
        ],
      },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.createDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1" }),
      expect.objectContaining({
        force: true,
        label: "Chat autosave",
      }),
    );
  });

  it("autosaves source-backed object transforms at the end of the agent turn", async () => {
    const config = mocks.pluginConfig as AgentChatConfig | undefined;
    expect(config?.onAgentTurnComplete).toBeTypeOf("function");

    await config!.onAgentTurnComplete!(
      { type: "deck", id: "deck-1" },
      {
        threadId: "thread-1",
        runId: "run-1",
        events: [
          {
            event: {
              type: "tool_done",
              tool: "transform-slide-objects",
              input: { deckId: "deck-1", slideId: "slide-1" },
              completedSideEffect: true,
            },
          },
        ],
      },
    );

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.createDeckVersionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deck-1" }),
      expect.objectContaining({
        force: true,
        label: "Chat autosave",
      }),
    );
  });
});
