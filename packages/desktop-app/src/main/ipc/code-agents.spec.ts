import { beforeEach, describe, expect, it, vi } from "vitest";

const onHandlers = new Map<string, (...args: any[]) => void>();

vi.mock("electron", () => ({
  app: {},
  clipboard: {},
  desktopCapturer: {},
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      onHandlers.set(channel, listener);
    }),
  },
  shell: {},
  systemPreferences: {},
}));

import {
  registerCodeAgentsIpc,
  type CodeAgentsIpcDeps,
} from "./code-agents.js";

describe("registerCodeAgentsIpc transcript subscriptions", () => {
  beforeEach(() => {
    onHandlers.clear();
  });

  it("sends a reconnect snapshot from the main-process transcript authority", () => {
    const removeSubscription = vi.fn();
    const initializeSubscription = vi.fn(() => ({
      status: "ok" as const,
      runId: "run-1",
      events: [
        {
          id: "event-1",
          runId: "run-1",
          type: "system" as const,
          text: "Readable fallback text",
          createdAt: "2026-07-19T00:00:00.000Z",
          metadata: { futureProviderPayload: { ignoredByRenderer: true } },
        },
      ],
    }));
    const sendBatch = vi.fn();
    const setSubscription = vi.fn();
    const watchSubscription = vi.fn();
    const deps = {
      isObject: (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
      firstStringValue: (...values: unknown[]) =>
        values.find(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        ),
      timestampSlug: () => "snapshot",
      normalizeCodeAgentRunId: (value: unknown) =>
        typeof value === "string" && value ? value : null,
      removeCodeAgentTranscriptSubscription: removeSubscription,
      initializeCodeAgentTranscriptSubscriptionKeys: initializeSubscription,
      watchCodeAgentTranscriptSubscription: watchSubscription,
      setCodeAgentTranscriptSubscription: setSubscription,
      sendCodeAgentTranscriptSubscriptionBatch: sendBatch,
    } as unknown as CodeAgentsIpcDeps;

    registerCodeAgentsIpc(deps);

    const subscribe = onHandlers.get("code-agents:subscribe-transcript");
    expect(subscribe).toBeTypeOf("function");
    const sender = { id: 7, once: vi.fn() };
    subscribe?.(
      { sender },
      {
        subscriptionId: "reconnect-1",
        request: { runId: "run-1" },
      },
    );

    expect(setSubscription).toHaveBeenCalledWith(
      "reconnect-1",
      expect.objectContaining({ id: "reconnect-1", runId: "run-1" }),
    );
    expect(watchSubscription).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reconnect-1", runId: "run-1" }),
      expect.objectContaining({
        status: "ok",
        runId: "run-1",
        reason: "snapshot",
        events: [
          expect.objectContaining({
            text: "Readable fallback text",
            metadata: { futureProviderPayload: { ignoredByRenderer: true } },
          }),
        ],
      }),
    );
  });
});
