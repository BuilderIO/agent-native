import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: new Map<string, unknown>(),
  saveGmailDraft: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async (key: string) => mocks.appState.get(key),
  writeAppState: async (key: string, value: unknown) => {
    mocks.appState.set(key, value);
  },
  deleteAppState: vi.fn(),
  deleteAppStateByPrefix: vi.fn(),
  listAppState: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "owner@example.com",
  buildDeepLink: () => "/mail",
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async () => ({}),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: vi.fn(),
  countOutcome: vi.fn(),
}));

vi.mock("../server/lib/gmail-drafts.js", () => ({
  saveGmailDraft: mocks.saveGmailDraft,
  deleteGmailDraft: vi.fn(),
  findGmailDraftAccount: vi.fn(),
}));

import {
  GmailQuotaCooldownError,
  GmailQuotaRefusedError,
} from "../server/lib/gmail-quota.js";
import manageDraft from "./manage-draft";

const draft = {
  action: "create",
  id: "refund-ivy",
  to: "ivy@example.com",
  subject: "Your refund",
  body: "Hi Ivy, your refund is on its way.",
};

/** A model that saves the same draft twice, then stops. */
async function saveTwice(): Promise<Array<Record<string, unknown>>> {
  const { runAgentLoop } = await import("@agent-native/core/server");
  let turn = 0;
  const events: Array<Record<string, unknown>> = [];
  await runAgentLoop({
    engine: {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream() {
        turn++;
        if (turn <= 2) {
          yield {
            type: "assistant-content" as const,
            parts: [
              {
                type: "tool-call" as const,
                id: `call-${turn}`,
                name: "manage-draft",
                input: draft,
              },
            ],
          };
          yield { type: "stop" as const, reason: "tool_use" as const };
          return;
        }
        yield {
          type: "assistant-content" as const,
          parts: [{ type: "text" as const, text: "Done." }],
        };
        yield { type: "stop" as const, reason: "end_turn" as const };
      },
    },
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "Draft Ivy's reply." }] },
    ],
    actions: { "manage-draft": manageDraft as never },
    send: (event) => {
      events.push(event as unknown as Record<string, unknown>);
    },
    signal: new AbortController().signal,
  });
  return events;
}

function outcomeUnknownStop(events: Array<Record<string, unknown>>) {
  return events.some(
    (event) =>
      event.type === "error" &&
      event.errorCode === "write_tool_outcome_unknown",
  );
}

describe("manage-draft in the agent loop", () => {
  beforeEach(() => {
    mocks.appState.clear();
    mocks.saveGmailDraft.mockReset();
  });

  it("saves the draft on a retry after Mail's Gmail budget refused it", async () => {
    mocks.saveGmailDraft
      .mockRejectedValueOnce(new GmailQuotaRefusedError(5_000))
      .mockResolvedValueOnce({
        draftId: "gmail-draft-1",
        accountEmail: "owner@example.com",
        created: true,
      });

    const events = await saveTwice();

    const done = events.filter((event) => event.type === "tool_done");
    expect(done[0]).toMatchObject({
      isError: true,
      completedSideEffect: false,
    });
    expect(done[1]).toMatchObject({ completedSideEffect: true });
    expect(outcomeUnknownStop(events)).toBe(false);
    expect(mocks.saveGmailDraft).toHaveBeenCalledTimes(2);
    expect(mocks.appState.get("compose-refund-ivy")).toMatchObject({
      savedDraftId: "gmail-draft-1",
    });
  });

  it("still holds back a retry after Gmail itself answered 429", async () => {
    mocks.saveGmailDraft.mockRejectedValue(new GmailQuotaCooldownError(5_000));

    const events = await saveTwice();

    expect(outcomeUnknownStop(events)).toBe(true);
    expect(mocks.saveGmailDraft).toHaveBeenCalledTimes(1);
  });
});
