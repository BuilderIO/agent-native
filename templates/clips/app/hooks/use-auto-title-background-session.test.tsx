// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpChangeVersion: vi.fn(),
  callAction: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  getChangeVersion: vi.fn(() => 0),
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
});
