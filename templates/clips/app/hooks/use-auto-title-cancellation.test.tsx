// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpChangeVersion: vi.fn(),
  callAction: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  getChangeVersion: vi.fn(() => 0),
  sendToAgentChat: vi.fn(),
  sendToAgentChatAndConfirm: vi.fn(),
  startBackgroundAgentSession: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  getBackgroundAgentSessionStatus: mocks.getBackgroundAgentSessionStatus,
  sendToAgentChat: mocks.sendToAgentChat,
  sendToAgentChatAndConfirm: mocks.sendToAgentChatAndConfirm,
  startBackgroundAgentSession: mocks.startBackgroundAgentSession,
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  const React = await import("react");
  return {
    bumpChangeVersion: (...args: unknown[]) => mocks.bumpChangeVersion(...args),
    callAction: (...args: unknown[]) => mocks.callAction(...args),
    getChangeVersion: mocks.getChangeVersion,
    useChangeVersion: () => 0,
    // Stands in for React Query: the action is served by the same `callAction`
    // mock the tests configure, and `refetch` resolves with the new data.
    useActionQuery: (name: string, args: unknown) => {
      const [data, setData] = React.useState<unknown>();
      const refetch = React.useCallback(async () => {
        const next = await mocks.callAction(name, args, { method: "GET" });
        setData(next);
        return { data: next };
      }, []);
      React.useEffect(() => {
        void refetch();
      }, [refetch]);
      return { data, refetch };
    },
  };
});
vi.mock("@shared/clips-ai-prefs", () => ({
  fullVideoAiModelSelection: () => null,
}));

import { useAutoTitleBridge } from "./use-auto-title";

const requestedAt = "2026-07-14T12:00:00.000Z";
const requestId = "workflow-request-123";
const workflowTabId =
  "clips-workflow:rec_123:2026-07-14T12%3A00%3A00.000Z:workflow-request-123:run";
const workflowRequest = {
  kind: "generate-workflow",
  recordingId: "rec_123",
  requestedAt,
  requestId,
  message: "Generate an email summary",
  transcriptText: "We agreed to ship on Friday.",
};
const workflowSession = {
  recordingId: "rec_123",
  kind: "generate-workflow",
  requestedAt,
  requestId,
  operationId: workflowTabId,
  threadId: workflowTabId,
  turnId: "turn-123",
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function TestBridge() {
  useAutoTitleBridge();
  return null;
}

function acceptedHandle() {
  const receipt = {
    operationId: workflowTabId,
    threadId: workflowTabId,
    turnId: "turn-123",
  };
  return {
    ...receipt,
    accepted: Promise.resolve(receipt),
    completion: Promise.resolve(),
    status: vi.fn(),
    cancel: vi.fn(),
    open: vi.fn(),
  };
}

function workflowOperations(operation: string) {
  return mocks.callAction.mock.calls.filter(
    ([name, payload]) =>
      name === "reconcile-workflow-generation" &&
      payload?.operation === operation,
  );
}

function configureActions(
  snapshot: Record<string, unknown>,
  overrides: Record<
    string,
    (payload?: Record<string, unknown>) => unknown
  > = {},
) {
  mocks.callAction.mockImplementation(
    async (name: string, payload?: { operation?: string }) => {
      if (name === "list-ai-requests") {
        return { titleCandidates: [], activeSessions: [], ...snapshot };
      }
      const override = payload?.operation
        ? overrides[payload.operation]
        : undefined;
      if (override) return override(payload);
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
}

async function renderBridge() {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<TestBridge />));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startBackgroundAgentSession.mockImplementation(acceptedHandle);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("workflow generation background sessions", () => {
  it("starts a background session, tracks it, and consumes the delivered request", async () => {
    configureActions({ requests: [workflowRequest] });
    await renderBridge();

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledOnce(),
    );
    expect(mocks.startBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: workflowRequest.message,
        operationId: workflowTabId,
        threadId: workflowTabId,
        usageLabel: "clips:generate-workflow",
        instructions: expect.stringContaining("We agreed to ship on Friday."),
      }),
    );
    const identity = {
      recordingId: "rec_123",
      requestedAt,
      requestId,
      tabId: workflowTabId,
    };
    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "reconcile-workflow-generation",
        { operation: "consume", ...identity },
      ),
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      { operation: "track", ...identity },
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "reconcile-workflow-generation",
      { operation: "mark-delivered", ...identity },
    );
    expect(mocks.sendToAgentChat).not.toHaveBeenCalled();
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("opens the background thread only when the request asked for chat", async () => {
    const handle = acceptedHandle();
    mocks.startBackgroundAgentSession.mockReturnValue(handle);
    configureActions({ requests: [{ ...workflowRequest, openInChat: true }] });
    await renderBridge();

    await vi.waitFor(() => expect(handle.open).toHaveBeenCalledOnce());
  });

  it("releases the claim when the run manager rejects the session", async () => {
    mocks.startBackgroundAgentSession.mockImplementation(() => {
      const rejection = Object.assign(
        new Error("Background agent session was rejected (HTTP 403)"),
        { status: 403 },
      );
      return {
        ...acceptedHandle(),
        accepted: Promise.reject(rejection),
      };
    });
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: workflowTabId,
      threadId: workflowTabId,
      turnId: "turn-123",
      status: "unavailable",
    });
    configureActions({ requests: [workflowRequest] });
    await renderBridge();

    await vi.waitFor(() =>
      expect(workflowOperations("release")).toHaveLength(1),
    );
    expect(workflowOperations("mark-delivered")).toHaveLength(0);
    expect(workflowOperations("consume")).toHaveLength(0);
  });

  it("keeps the claim and request when acceptance cannot be confirmed", async () => {
    mocks.startBackgroundAgentSession.mockImplementation(() => ({
      ...acceptedHandle(),
      accepted: Promise.reject(new Error("network down")),
    }));
    mocks.getBackgroundAgentSessionStatus.mockRejectedValue(
      new Error("network down"),
    );
    configureActions({ requests: [workflowRequest] });
    await renderBridge();

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledOnce(),
    );
    await act(async () => {});
    expect(workflowOperations("release")).toHaveLength(0);
    expect(workflowOperations("mark-delivered")).toHaveLength(0);
    expect(workflowOperations("consume")).toHaveLength(0);
  });

  it("does not start a session when persisted tracking rejects the request", async () => {
    configureActions(
      { requests: [workflowRequest] },
      { track: () => ({ reconciled: false, reason: "stale" }) },
    );
    await renderBridge();

    await vi.waitFor(() => expect(workflowOperations("track")).toHaveLength(1));
    expect(mocks.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it("stops retrying once tracking consumes a finished workflow's request", async () => {
    configureActions(
      { requests: [workflowRequest] },
      {
        track: () => ({
          reconciled: false,
          tracked: false,
          consumed: true,
          reason: "terminal",
        }),
      },
    );
    await renderBridge();

    await vi.waitFor(() => expect(workflowOperations("track")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    expect(workflowOperations("track")).toHaveLength(1);
    expect(mocks.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it("consumes a delivered request after reload without restarting it", async () => {
    configureActions({
      requests: [{ ...workflowRequest, deliveredTabId: workflowTabId }],
    });
    await renderBridge();

    await vi.waitFor(() =>
      expect(workflowOperations("consume")).toHaveLength(1),
    );
    expect(mocks.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it.each([
    ["errored", "failed run"],
    ["aborted", "stopped run"],
    ["completed", "run that never saved the workflow"],
  ])(
    "reconciles the exact workflow tab when the session is %s (%s)",
    async (status) => {
      mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
        operationId: workflowTabId,
        threadId: workflowTabId,
        turnId: "turn-123",
        runId: "run-1",
        status,
      });
      configureActions({ requests: [], activeSessions: [workflowSession] });
      await renderBridge();

      await vi.waitFor(() =>
        expect(workflowOperations("stop")).toHaveLength(1),
      );
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: workflowTabId,
          threadId: workflowTabId,
          turnId: "turn-123",
        }),
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
    },
  );

  it("retries the stop reconciliation after a transient failure", async () => {
    let attempts = 0;
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: workflowTabId,
      threadId: workflowTabId,
      turnId: "turn-123",
      runId: "run-1",
      status: "errored",
    });
    configureActions(
      { requests: [], activeSessions: [workflowSession] },
      {
        stop: () => {
          if (attempts++ === 0) throw new Error("connection dropped");
          return { reconciled: true };
        },
      },
    );
    await renderBridge();

    await vi.waitFor(() => expect(workflowOperations("stop")).toHaveLength(2), {
      timeout: 5000,
    });
  });

  it("leaves a still-running workflow session alone", async () => {
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: workflowTabId,
      threadId: workflowTabId,
      turnId: "turn-123",
      runId: "run-1",
      status: "running",
    });
    configureActions({ requests: [], activeSessions: [workflowSession] });
    await renderBridge();

    await vi.waitFor(() =>
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalled(),
    );
    expect(workflowOperations("stop")).toHaveLength(0);
  });
});

describe("queued AI request background sessions", () => {
  const chaptersRequest = {
    kind: "regenerate-chapters",
    recordingId: "rec_123",
    requestedAt,
    message: "Generate chapters",
    transcriptText: "Chapter one begins here.",
  };
  const stableId = `clips-ai-request:rec_123:regenerate-chapters:${encodeURIComponent(requestedAt)}`;

  it("dispatches every non-workflow kind without a mounted chat panel", async () => {
    configureActions({ requests: [chaptersRequest] });
    mocks.callAction.mockImplementation(async (name: string) =>
      name === "list-ai-requests"
        ? {
            requests: [chaptersRequest],
            activeSessions: [],
            titleCandidates: [],
          }
        : { consumed: true },
    );
    await renderBridge();

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledOnce(),
    );
    expect(mocks.startBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Generate chapters",
        operationId: stableId,
        threadId: stableId,
        usageLabel: "clips:regenerate-chapters",
        instructions: expect.stringContaining("Chapter one begins here."),
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith("consume-ai-request", {
        recordingId: "rec_123",
        kind: "regenerate-chapters",
        requestedAt,
      }),
    );
    expect(mocks.sendToAgentChat).not.toHaveBeenCalled();
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("persists a cancelled status when its session is aborted", async () => {
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: stableId,
      threadId: stableId,
      turnId: "turn-9",
      runId: "run-9",
      status: "aborted",
    });
    mocks.callAction.mockImplementation(async (name: string) =>
      name === "list-ai-requests"
        ? {
            requests: [],
            titleCandidates: [],
            activeSessions: [
              {
                recordingId: "rec_123",
                kind: "regenerate-chapters",
                requestedAt,
                operationId: stableId,
                threadId: stableId,
                turnId: "turn-9",
              },
            ],
          }
        : { cancelled: true },
    );
    await renderBridge();

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({
          recordingId: "rec_123",
          kind: "regenerate-chapters",
          requestedAt,
          operationId: stableId,
          runId: "run-9",
          status: "cancelled",
        }),
      ),
    );
  });
});
