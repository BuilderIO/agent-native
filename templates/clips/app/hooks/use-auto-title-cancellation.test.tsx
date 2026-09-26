// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpChangeVersion: vi.fn(),
  callAction: vi.fn(),
  getChangeVersion: vi.fn(() => 0),
  sendToAgentChat: vi.fn((options: { tabId?: string }) => options.tabId),
  sendToAgentChatAndConfirm: vi.fn(async (options: { tabId?: string }) => ({
    tabId: options.tabId,
    delivered: true,
  })),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "chat-123",
  sendToAgentChat: mocks.sendToAgentChat,
  sendToAgentChatAndConfirm: mocks.sendToAgentChatAndConfirm,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  bumpChangeVersion: (...args: unknown[]) => mocks.bumpChangeVersion(...args),
  callAction: (...args: unknown[]) => mocks.callAction(...args),
  getChangeVersion: mocks.getChangeVersion,
  useChangeVersions: () => 0,
}));
vi.mock("@shared/clips-ai-prefs", () => ({
  fullVideoAiModelSelection: () => null,
}));
vi.mock("./use-library", () => ({
  useRecordings: () => ({
    data: {
      recordings: [
        {
          id: "rec_123",
          title: "Demo recording",
          status: "ready",
          createdAt: "2026-07-14T12:00:00.000Z",
        },
      ],
    },
  }),
}));

import { aiRequestTabId } from "@shared/ai-request-status";

import { useAutoTitleBridge } from "./use-auto-title";

const requestedAt = "2026-07-14T12:00:00.000Z";
const requestId = "workflow-request-123";
const workflowTabId =
  "clips-workflow:rec_123:2026-07-14T12%3A00%3A00.000Z:workflow-request-123:chat-123";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function TestBridge() {
  useAutoTitleBridge();
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.callAction.mockImplementation(
    async (name: string, payload?: { operation?: string }) => {
      if (name === "list-ai-requests") {
        return {
          requests: [
            {
              kind: "generate-workflow",
              recordingId: "rec_123",
              requestedAt,
              requestId,
              message: "Generate an email summary",
            },
          ],
        };
      }
      if (payload?.operation === "track") {
        return { reconciled: false, tracked: true };
      }
      if (payload?.operation === "release") {
        return { reconciled: false, released: true };
      }
      if (payload?.operation === "mark-delivered") {
        return { reconciled: false, delivered: true };
      }
      if (payload?.operation === "consume") {
        return { reconciled: false, consumed: true };
      }
      return { reconciled: true };
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );

  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root.render(<TestBridge />);
  });
  await vi.waitFor(() =>
    expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
  );
  expect(mocks.callAction).toHaveBeenCalledWith(
    "reconcile-workflow-generation",
    {
      operation: "track",
      recordingId: "rec_123",
      requestedAt,
      requestId,
      tabId: workflowTabId,
    },
  );
  await vi.waitFor(() =>
    expect(mocks.callAction).toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      {
        operation: "mark-delivered",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: workflowTabId,
      },
    ),
  );
  await vi.waitFor(() =>
    expect(mocks.callAction).toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      {
        operation: "consume",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: workflowTabId,
      },
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("workflow generation cancellation", () => {
  it("preserves the queued request when chat delivery is rejected", async () => {
    await act(async () => root.unmount());
    mocks.callAction.mockClear();
    mocks.callAction.mockImplementation(
      async (name: string, payload?: { operation?: string }) => {
        if (name === "list-ai-requests") {
          return {
            requests: [
              {
                kind: "generate-workflow",
                recordingId: "rec_123",
                requestedAt,
                requestId,
                message: "Generate an email summary",
              },
            ],
          };
        }
        if (payload?.operation === "track") {
          return { reconciled: false, tracked: true };
        }
        if (payload?.operation === "release") {
          return {
            reconciled: false,
            released: false,
            reason: "different-run",
          };
        }
        return { reconciled: true };
      },
    );
    mocks.sendToAgentChatAndConfirm.mockClear();
    mocks.sendToAgentChatAndConfirm.mockResolvedValueOnce({
      tabId: workflowTabId,
      delivered: false,
    });
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "reconcile-workflow-generation",
        expect.objectContaining({ operation: "release" }),
      ),
    );
    expect(
      mocks.callAction.mock.calls.filter(
        ([, payload]) => payload?.operation === "release",
      ),
    ).toHaveLength(1);
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      expect.objectContaining({ operation: "mark-delivered" }),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      expect.objectContaining({ operation: "consume" }),
    );
  });

  it("does not dispatch when persisted tracking rejects the request", async () => {
    await act(async () => root.unmount());
    mocks.sendToAgentChatAndConfirm.mockClear();
    mocks.callAction.mockImplementation(
      async (name: string, payload?: { operation?: string }) => {
        if (name === "list-ai-requests") {
          return {
            requests: [
              {
                kind: "generate-workflow",
                recordingId: "rec_123",
                requestedAt,
                requestId,
                message: "Generate an email summary",
              },
            ],
          };
        }
        return payload?.operation === "track"
          ? { reconciled: false, reason: "stale" }
          : { reconciled: true };
      },
    );
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "reconcile-workflow-generation",
        expect.objectContaining({ operation: "track" }),
      ),
    );
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("consumes a delivered request after reload without redispatching", async () => {
    await act(async () => root.unmount());
    mocks.callAction.mockClear();
    mocks.sendToAgentChatAndConfirm.mockClear();
    mocks.callAction.mockImplementation(
      async (name: string, payload?: { operation?: string }) => {
        if (name === "list-ai-requests") {
          return {
            requests: [
              {
                kind: "generate-workflow",
                recordingId: "rec_123",
                requestedAt,
                requestId,
                deliveredTabId: workflowTabId,
                message: "Generate an email summary",
              },
            ],
          };
        }
        return payload?.operation === "consume"
          ? { reconciled: false, consumed: true }
          : { reconciled: true };
      },
    );
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "reconcile-workflow-generation",
        {
          operation: "consume",
          recordingId: "rec_123",
          requestedAt,
          requestId,
          tabId: workflowTabId,
        },
      ),
    );
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("reconciles the exact workflow agent tab after a page reload", async () => {
    await act(async () => root.unmount());
    let stopAttempts = 0;
    mocks.callAction.mockImplementation(
      async (name: string, payload?: { operation?: string }) => {
        if (name === "list-ai-requests") return { requests: [] };
        if (payload?.operation === "stop" && stopAttempts++ === 0) {
          throw new Error("connection dropped");
        }
        return { reconciled: true };
      },
    );
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, tabId: "another-tab" },
      }),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      expect.objectContaining({ operation: "stop" }),
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, tabId: workflowTabId },
      }),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      expect.objectContaining({ operation: "stop" }),
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: {
          isRunning: false,
          tabId: workflowTabId,
          reason: "stopped",
        },
      }),
    );

    await vi.waitFor(
      () =>
        expect(
          mocks.callAction.mock.calls.filter(
            ([, payload]) => payload?.operation === "stop",
          ),
        ).toHaveLength(2),
      { timeout: 2500 },
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      {
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: workflowTabId,
      },
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: {
          isRunning: false,
          tabId: workflowTabId,
          reason: "failed",
        },
      }),
    );

    await vi.waitFor(() =>
      expect(
        mocks.callAction.mock.calls.filter(
          ([, payload]) => payload?.operation === "stop",
        ),
      ).toHaveLength(3),
    );
  });

  it("marks a stopped queued AI request cancelled on its exact chat tab", async () => {
    await act(async () => root.unmount());
    mocks.callAction.mockClear();
    mocks.callAction.mockImplementation(async (name: string) => {
      if (name === "list-ai-requests") {
        return {
          requests: [
            {
              kind: "regenerate-chapters",
              recordingId: "rec_123",
              requestedAt,
              message: "Generate chapters",
            },
          ],
        };
      }
      return { cancelled: true };
    });
    mocks.sendToAgentChatAndConfirm.mockClear();
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    const tabId = aiRequestTabId("rec_123", "regenerate-chapters", requestedAt);
    expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ tabId }),
      { timeoutMs: 10_000 },
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, reason: "stopped", tabId },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        {
          recordingId: "rec_123",
          kind: "regenerate-chapters",
          requestedAt,
          status: "cancelled",
        },
      ),
    );
  });

  it("marks a failed queued AI request failed on its exact chat tab", async () => {
    await act(async () => root.unmount());
    mocks.callAction.mockClear();
    mocks.callAction.mockImplementation(async (name: string) => {
      if (name === "list-ai-requests") {
        return {
          requests: [
            {
              kind: "regenerate-chapters",
              recordingId: "rec_123",
              requestedAt,
              message: "Generate chapters",
            },
          ],
        };
      }
      return { status: "failed" };
    });
    mocks.sendToAgentChatAndConfirm.mockClear();
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    const tabId = aiRequestTabId("rec_123", "regenerate-chapters", requestedAt);
    expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ tabId }),
      { timeoutMs: 10_000 },
    );

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, reason: "failed", tabId },
      }),
    );

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        {
          recordingId: "rec_123",
          kind: "regenerate-chapters",
          requestedAt,
          status: "failed",
        },
      ),
    );
  });

  it("does not mark a completed queued AI request failed without a reason", async () => {
    await act(async () => root.unmount());
    mocks.callAction.mockClear();
    mocks.callAction.mockImplementation(async (name: string) => {
      if (name === "list-ai-requests") {
        return {
          requests: [
            {
              kind: "regenerate-chapters",
              recordingId: "rec_123",
              requestedAt,
              message: "Generate chapters",
            },
          ],
        };
      }
      return { status: "completed" };
    });
    mocks.sendToAgentChatAndConfirm.mockClear();
    root = createRoot(container);
    await act(async () => root.render(<TestBridge />));

    await vi.waitFor(() =>
      expect(mocks.sendToAgentChatAndConfirm).toHaveBeenCalledOnce(),
    );
    const tabId = aiRequestTabId("rec_123", "regenerate-chapters", requestedAt);

    window.dispatchEvent(
      new CustomEvent("agentNative.chatRunning", {
        detail: { isRunning: false, tabId },
      }),
    );

    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.anything(),
    );
  });
});
