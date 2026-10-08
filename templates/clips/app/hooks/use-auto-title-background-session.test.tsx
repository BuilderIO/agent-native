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
  BACKGROUND_SESSION_MISSING_CONFIRMATION_MS,
  backgroundAiRequestStatus,
  nextAiRequestRetryDelay,
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
  vi.clearAllTimers();
  vi.useRealTimers();
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
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      ...receipt,
      status: "unavailable",
    });
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
    expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: stableId }),
    );
    expect(uncertainHandle.status).not.toHaveBeenCalled();
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

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await vi.waitFor(() =>
      expect(mocks.startBackgroundAgentSession).toHaveBeenCalledTimes(2),
    );
    expect(
      mocks.startBackgroundAgentSession.mock.calls.map(
        ([options]) => (options as { operationId: string }).operationId,
      ),
    ).toEqual([stableId, stableId]);
    expect(nextUncertainHandle.status).not.toHaveBeenCalled();
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

  it("keeps a known run indeterminate after transient status endpoint errors", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "unavailable-operation",
      threadId: "unavailable-thread",
      turnId: "unavailable-turn",
      runId: "run-1",
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS + 20_000,
      );
    });
    expect(
      mocks.getBackgroundAgentSessionStatus.mock.calls.length,
    ).toBeGreaterThan(10);
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("restarts the missing confirmation window after a transient status error", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "intermittently-missing-operation",
      threadId: "intermittently-missing-thread",
      turnId: "intermittently-missing-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus
      .mockResolvedValueOnce({ ...session, status: "running", runId: "run-1" })
      .mockResolvedValueOnce({ ...session, status: "unavailable" })
      .mockRejectedValueOnce(new Error("status endpoint unavailable"))
      .mockResolvedValue({ ...session, status: "unavailable" });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS - 1,
      );
    });
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("fails a persisted run when its previously seen run id disappears", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "vanished-operation",
      threadId: "vanished-thread",
      turnId: "vanished-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus
      .mockResolvedValueOnce({ ...session, status: "running", runId: "run-1" })
      .mockResolvedValueOnce({ ...session, status: "unavailable" })
      .mockResolvedValue({ ...session, status: "unavailable" });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({ status: "working", runId: "run-1" }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledTimes(2);
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS - 1,
      );
    });
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({ status: "failed" }),
      ),
    );
    expect(
      mocks.getBackgroundAgentSessionStatus.mock.calls.length,
    ).toBeGreaterThan(2);
  });

  it("treats a run that reappears after a 404 as live", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "reappearing-operation",
      threadId: "reappearing-thread",
      turnId: "reappearing-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus
      .mockResolvedValueOnce({ ...session, status: "running", runId: "run-1" })
      .mockResolvedValueOnce({ ...session, status: "unavailable" })
      .mockResolvedValue({ ...session, status: "running", runId: "run-1" });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS + 20_000,
      );
    });

    expect(
      mocks.getBackgroundAgentSessionStatus.mock.calls.length,
    ).toBeGreaterThan(3);
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("fails an active receipt after repeated 404s even before a run id appears", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "not-yet-created-operation",
      threadId: "not-yet-created-thread",
      turnId: "not-yet-created-turn",
      updatedAt: requestedAt,
    };
    mocks.getBackgroundAgentSessionStatus.mockResolvedValue({
      ...session,
      status: "unavailable",
    });

    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });

    await vi.waitFor(() =>
      expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.getBackgroundAgentSessionStatus).toHaveBeenCalledTimes(2);
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS - 1,
      );
    });
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "failed" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await vi.waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "update-ai-request-status",
        expect.objectContaining({ status: "failed" }),
      ),
    );
  });

  it("rechecks a missing run before retrying a failed status write", async () => {
    vi.useFakeTimers();
    const session = {
      recordingId: request.recordingId,
      kind: "remove-filler-words",
      requestedAt,
      operationId: "recovered-after-status-write-failure",
      threadId: "recovered-thread",
      turnId: "recovered-turn",
      updatedAt: requestedAt,
    };
    let failedWrites = 0;
    mocks.getBackgroundAgentSessionStatus.mockImplementation(async () =>
      failedWrites === 0
        ? { ...session, status: "unavailable" }
        : { ...session, status: "running", runId: "run-recovered" },
    );
    await renderBridge({
      requests: [],
      activeSessions: [session],
      titleCandidates: [],
    });
    mocks.callAction.mockImplementation(async (name: string, args: unknown) => {
      if (
        name === "update-ai-request-status" &&
        (args as { status?: string }).status === "failed"
      ) {
        failedWrites += 1;
        throw new Error("status action temporarily unavailable");
      }
      return { updated: true };
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        BACKGROUND_SESSION_MISSING_CONFIRMATION_MS + 20_000,
      );
    });

    expect(failedWrites).toBe(1);
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-ai-request-status",
      expect.objectContaining({ status: "working", runId: "run-recovered" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(failedWrites).toBe(1);
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

  it("backs off retries exponentially and caps the delay", async () => {
    const delays = [1_000];
    for (let index = 0; index < 6; index += 1) {
      delays.push(nextAiRequestRetryDelay(delays[delays.length - 1] ?? 1_000));
    }
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("waits for each bounded backoff interval after transport failures", async () => {
    vi.useFakeTimers();
    const requestUpdateCalls = () =>
      mocks.callAction.mock.calls.filter(
        ([name]) => name === "update-ai-request-status",
      );
    mocks.callAction.mockImplementation(async (name: string) => {
      if (name === "list-ai-requests") {
        return {
          requests: [request],
          activeSessions: [],
          titleCandidates: [],
        };
      }
      if (name === "update-ai-request-status") {
        throw new Error("status action unavailable");
      }
      return { consumed: true };
    });
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(<TestBridge />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestUpdateCalls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(requestUpdateCalls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestUpdateCalls()).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(requestUpdateCalls()).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestUpdateCalls()).toHaveLength(3);
  });
});
