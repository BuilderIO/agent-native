// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpChangeVersion: vi.fn(),
  callAction: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  getChangeVersion: vi.fn(() => 0),
  refetch: vi.fn(),
  sendToAgentChatAndConfirm: vi.fn(),
  startBackgroundAgentSession: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "chat-123",
  getBackgroundAgentSessionStatus: mocks.getBackgroundAgentSessionStatus,
  sendToAgentChatAndConfirm: mocks.sendToAgentChatAndConfirm,
  startBackgroundAgentSession: mocks.startBackgroundAgentSession,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/hooks", async () => {
  const React = await import("react");
  return {
    bumpChangeVersion: (...args: unknown[]) => mocks.bumpChangeVersion(...args),
    callAction: (...args: unknown[]) => mocks.callAction(...args),
    getChangeVersion: mocks.getChangeVersion,
    useChangeVersion: () => 0,
    useActionQuery: (name: string, args: unknown) => {
      const [data, setData] = React.useState<unknown>();
      const refetch = React.useCallback(async () => {
        const next = await mocks.callAction(name, args, { method: "GET" });
        const snapshot =
          next && typeof next === "object"
            ? {
                ...(next as Record<string, unknown>),
                requests: [
                  ...((next as { requests?: unknown[] }).requests ?? []),
                ],
                activeSessions: [
                  ...((next as { activeSessions?: unknown[] }).activeSessions ??
                    []),
                ],
                titleCandidates: [
                  ...((next as { titleCandidates?: unknown[] })
                    .titleCandidates ?? []),
                ],
              }
            : next;
        setData(snapshot);
        return { data: snapshot };
      }, []);
      mocks.refetch.mockImplementation(refetch);
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

import type { BackgroundAgentSessionHandle } from "@agent-native/core/client/agent-chat";
import { aiRequestTabId } from "@shared/ai-request-status";

import {
  backgroundAiRequestStatus,
  parseFillerTranscriptSegments,
  useAutoTitleBridge,
} from "./use-auto-title";

const requestedAt = "2026-10-08T12:00:00.000Z";
const request = {
  kind: "remove-filler-words",
  recordingId: "rec_123",
  requestedAt,
  message: "Remove the filler words from this recording.",
  segmentsJson: JSON.stringify([
    { startMs: 0, endMs: 500, text: "Um, let's begin." },
  ]),
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function TestBridge() {
  useAutoTitleBridge();
  return null;
}

async function renderBridge(result: Record<string, unknown>) {
  mocks.callAction.mockImplementation(async (name: string) =>
    name === "list-ai-requests" ? result : { consumed: true },
  );
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root.render(<TestBridge />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("Clips filler-word background sessions", () => {
  it("distinguishes valid empty transcript segments from unreadable payloads", () => {
    expect(parseFillerTranscriptSegments(undefined)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(parseFillerTranscriptSegments("[]")).toEqual({
      ok: true,
      segments: [],
    });
    expect(parseFillerTranscriptSegments("{")).toEqual({
      ok: false,
      reason: "invalid-json",
    });
    expect(parseFillerTranscriptSegments("[{}]")).toEqual({
      ok: false,
      reason: "invalid-segment",
    });
  });

  it("skips blank text segments when their timestamps are valid", () => {
    expect(
      parseFillerTranscriptSegments(
        JSON.stringify([
          { startMs: 0, endMs: 250, text: "  " },
          { startMs: 250, endMs: 500, text: "Um, let's begin." },
        ]),
      ),
    ).toMatchObject({
      ok: true,
      segments: [{ startMs: 250, endMs: 500, text: "Um, let's begin." }],
    });
  });

  it.each([null, "", "0"])(
    "rejects non-numeric transcript timestamps such as %j",
    (startMs) => {
      expect(
        parseFillerTranscriptSegments(
          JSON.stringify([{ startMs, endMs: 500, text: "Um, let's begin." }]),
        ),
      ).toEqual({ ok: false, reason: "invalid-segment" });
    },
  );

  it("does not treat an all-blank transcript as usable input", () => {
    expect(
      parseFillerTranscriptSegments(
        JSON.stringify([{ startMs: 0, endMs: 250, text: "  " }]),
      ),
    ).toEqual({ ok: false, reason: "invalid-segment" });
  });

  it("starts directly through the run manager and consumes only the accepted request", async () => {
    const stableId = aiRequestTabId(
      request.recordingId,
      "remove-filler-words",
      requestedAt,
    );
    const receipt = {
      operationId: stableId,
      threadId: stableId,
      turnId: "turn-123",
    };
    mocks.startBackgroundAgentSession.mockReturnValue({
      ...receipt,
      accepted: Promise.resolve(receipt),
      completion: Promise.resolve(),
      status: vi.fn(),
      cancel: vi.fn(),
      open: vi.fn(),
    } satisfies BackgroundAgentSessionHandle);

    await renderBridge({
      requests: [request],
      activeSessions: [],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledOnce(),
    );
    expect(mocks.startBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: request.message,
        operationId: stableId,
        threadId: stableId,
        usageLabel: "clips:remove-filler-words",
        instructions: JSON.stringify({
          recordingId: request.recordingId,
          transcriptSegments: JSON.parse(request.segmentsJson),
        }),
      }),
    );
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
    expect(mocks.callAction).toHaveBeenCalledWith("consume-ai-request", {
      recordingId: request.recordingId,
      kind: request.kind,
      requestedAt,
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({
        recordingId: request.recordingId,
        kind: request.kind,
        requestedAt,
        operationId: stableId,
        threadId: stableId,
        turnId: "turn-123",
        status: "working",
      }),
    );
  });

  it("marks malformed transcript JSON failed and consumes without starting a run", async () => {
    await renderBridge({
      requests: [{ ...request, segmentsJson: "{" }],
      activeSessions: [],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({
          kind: "remove-filler-words",
          requestedAt,
          status: "failed",
        }),
      ),
    );
    expect(mocks.startBackgroundAgentSession).not.toHaveBeenCalled();
    expect(mocks.callAction).toHaveBeenCalledWith("consume-ai-request", {
      recordingId: request.recordingId,
      kind: request.kind,
      requestedAt,
    });
  });

  it("maps durable truncation, errors, aborts, and completion to visible status", () => {
    const base = {
      operationId: "op",
      threadId: "thread",
      turnId: "turn",
      runId: "run",
    };
    expect(backgroundAiRequestStatus({ ...base, status: "completed" })).toBe(
      "completed",
    );
    expect(backgroundAiRequestStatus({ ...base, status: "truncated" })).toBe(
      "truncated",
    );
    expect(backgroundAiRequestStatus({ ...base, status: "errored" })).toBe(
      "failed",
    );
    expect(backgroundAiRequestStatus({ ...base, status: "aborted" })).toBe(
      "cancelled",
    );
    expect(
      backgroundAiRequestStatus({
        operationId: "op",
        threadId: "thread",
        turnId: "turn",
        status: "completed",
      }),
    ).toBeNull();
  });

  it("reattaches persisted receipts and records a truncated run for retry", async () => {
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "stable-operation",
      threadId: "stable-thread",
      turnId: "stable-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      ...session,
      status: "truncated",
      runId: "run-truncated",
      terminalReason: "output limit reached",
    });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({
          operationId: session.operationId,
          runId: "run-truncated",
          status: "truncated",
        }),
      ),
    );
    expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledWith(session);
    expect(mocks.sendToAgentChatAndConfirm).not.toHaveBeenCalled();
  });

  it("keeps an uncertain acceptance queued when status lookup is unavailable", async () => {
    const stableId = aiRequestTabId(
      request.recordingId,
      "remove-filler-words",
      requestedAt,
    );
    const receipt = {
      operationId: stableId,
      threadId: stableId,
      turnId: "turn-uncertain",
    };
    const uncertainAcceptance = Promise.reject(
      new Error("acknowledgement timed out"),
    );
    void uncertainAcceptance.catch(() => {});
    const uncertainHandle = {
      ...receipt,
      accepted: uncertainAcceptance,
      completion: Promise.resolve(),
      status: vi.fn().mockResolvedValue({ ...receipt, status: "unavailable" }),
      cancel: vi.fn(),
      open: vi.fn(),
    } satisfies BackgroundAgentSessionHandle;
    const nextUncertainAcceptance = Promise.reject(
      new Error("acknowledgement timed out"),
    );
    void nextUncertainAcceptance.catch(() => {});
    const nextUncertainHandle = {
      ...receipt,
      accepted: nextUncertainAcceptance,
      completion: Promise.resolve(),
      status: vi.fn().mockResolvedValue({ ...receipt, status: "unavailable" }),
      cancel: vi.fn(),
      open: vi.fn(),
    } satisfies BackgroundAgentSessionHandle;
    mocks.startBackgroundAgentSession
      .mockReturnValueOnce(uncertainHandle)
      .mockReturnValueOnce(nextUncertainHandle);

    await renderBridge({
      requests: [request],
      activeSessions: [],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledOnce(),
    );
    expect(uncertainHandle.status).toHaveBeenCalledOnce();
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "consume-ai-request",
      expect.anything(),
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({
        operationId: stableId,
        status: "working",
      }),
    );
    expect(
      mocks.callAction.mock.calls.some(
        ([name, payload]) =>
          name === "update-ai-request-status" &&
          payload?.operationId === stableId &&
          typeof payload?.turnId === "string",
      ),
    ).toBe(false);

    await act(async () => {
      await mocks.refetch();
    });

    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledTimes(2),
    );
    expect(
      mocks.startBackgroundAgentSession.mock.calls.map(
        ([options]) => (options as { operationId: string }).operationId,
      ),
    ).toEqual([stableId, stableId]);
    expect(nextUncertainHandle.status).toHaveBeenCalledOnce();
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "consume-ai-request",
      expect.anything(),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("marks a request failed only after the session route explicitly rejects it", async () => {
    const stableId = aiRequestTabId(
      request.recordingId,
      "remove-filler-words",
      requestedAt,
    );
    const receipt = {
      operationId: stableId,
      threadId: stableId,
      turnId: "turn-rejected",
    };
    const rejection = Object.assign(
      new Error("Background agent session was rejected (HTTP 422)"),
      { status: 422 },
    );
    const accepted = Promise.reject(rejection);
    void accepted.catch(() => {});
    mocks.startBackgroundAgentSession.mockReturnValue({
      ...receipt,
      accepted,
      completion: Promise.resolve(),
      status: vi.fn().mockResolvedValue({
        ...receipt,
        status: "unavailable",
      }),
      cancel: vi.fn(),
      open: vi.fn(),
    } satisfies BackgroundAgentSessionHandle);

    await renderBridge({
      requests: [request],
      activeSessions: [],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({ status: "failed" }),
      ),
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "consume-ai-request",
      expect.objectContaining({ requestedAt }),
    );
  });

  it("does not fail a queued run just because it has not started yet", async () => {
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "queued-operation",
      threadId: "queued-thread",
      turnId: "queued-turn",
      updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      ...session,
      status: "queued",
    });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledOnce(),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("keeps polling after status endpoint errors beyond the confirmation window", async () => {
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "unavailable-operation",
      threadId: "unavailable-thread",
      turnId: "unavailable-turn",
      updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    mocks.getBackgroundAgentSessionStatus.mockRejectedValue(
      new Error("status endpoint unavailable"),
    );

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledOnce(),
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("keeps monitor ownership when the active-session query refreshes", async () => {
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "stable-monitor-operation",
      threadId: "stable-monitor-thread",
      turnId: "stable-monitor-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      ...session,
      status: "queued",
    });

    await renderBridge({
      requests: [],
      activeSessions: [{ ...session }],
      titleCandidates: [],
    });
    await vi.waitFor(() =>
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledOnce(),
    );

    await act(async () => {
      await mocks.refetch();
    });
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    expect(
      mocks.getBackgroundAgentSessionStatus.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });
});
