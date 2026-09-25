import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callActionMock = vi.hoisted(() => vi.fn());
const sendDesignSourceHandoffAndConfirmMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ target: "local", delivered: true })),
);

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: callActionMock,
}));
vi.mock("@/lib/agent-chat", () => ({
  sendDesignSourceHandoffAndConfirm: sendDesignSourceHandoffAndConfirmMock,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import type { PendingStructureVerificationSession } from "@/pages/design-editor/command-types";
import type { PendingLiveStructureEdit } from "@/pages/design-editor/pending-edits";

import {
  PENDING_STRUCTURE_HARD_TIMEOUT_MS,
  PENDING_STRUCTURE_RUNTIME_POLL_MS,
} from "../editor-constants";
import { runApplyPendingVisualStylesWithAgent } from "./apply-pending-visual-styles-with-agent";

function structureEdit(index: number): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: `screen-${index}`,
    filename: `screen-${index}.html`,
    screenName: `Screen ${index}`,
    selector: `[data-node="subject-${index}"]`,
    sourceId: `subject-${index}`,
    sourceAnchor: { relPath: `screen-${index}.html` },
    anchorSelector: "",
    anchorSourceId: null,
    placement: "inside",
    removed: true,
    updatedAt: index,
    requestId: `request-${index}`,
  };
}

function argsFor(
  edits: PendingLiveStructureEdit[],
  snapshots: Map<number, Record<string, { html: string; nodeCount: number }>>,
  options: { hangReads?: boolean } = {},
) {
  const sessionRef = {
    current: undefined,
  } as { current: PendingStructureVerificationSession | undefined };
  const pendingEditsRef = { current: edits };
  const stagedSourceHandoffRef = { current: "idle" as const };
  const sourceVersions = new Map(
    edits.map((edit) => [edit.sourceAnchor!.relPath, "v0"]),
  );
  const runtimeRequests: number[] = [];
  const ackRequests: Array<{
    requestId: number;
    acks: Array<{ screenId: string; requestId: string; applied: boolean }>;
  }> = [];
  type AckState = (typeof ackRequests)[number] | null;
  const setPendingStructureAckRequest: Dispatch<SetStateAction<AckState>> = (
    value,
  ) => {
    const next = typeof value === "function" ? value(null) : value;
    if (next) ackRequests.push(next);
  };
  type RuntimeRequest = { requestId: number; screenIds: string[] };
  const setRuntimeStructureVerificationRequest: Dispatch<
    SetStateAction<RuntimeRequest | null>
  > = (value) => {
    const next = typeof value === "function" ? value(null) : value;
    if (!next) return;
    runtimeRequests.push(next.requestId);
    const edit = edits[runtimeRequests.length - 1];
    if (edit) {
      snapshots.set(next.requestId, {
        [edit.screenId]: { html: "<body></body>", nodeCount: 1 },
      });
    }
  };
  const clearPendingLiveEditState = vi.fn();
  const cancelPendingStructureVerification = vi.fn(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    session.abortController.abort();
  });

  callActionMock.mockImplementation(async (_action, input, callOptions) => {
    if (options.hangReads) {
      return new Promise((_resolve, reject) => {
        const signal = (callOptions as { signal?: AbortSignal } | undefined)
          ?.signal;
        const abort = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    }
    const path = (input as { path: string }).path;
    const index = Number(path.match(/screen-(\d+)/)?.[1]);
    const writeAt = index === 1 ? 65_000 : index === 2 ? 100_000 : 155_000;
    if (Date.now() >= writeAt) sourceVersions.set(path, "v1");
    return { versionHash: sourceVersions.get(path) };
  });

  return {
    args: {
      cancelPendingStructureVerification,
      clearPendingLiveEditState,
      id: "design",
      overviewScreens: edits.map((edit) => ({
        id: edit.screenId,
        filename: edit.filename,
        content: "",
        updatedAt: "1",
        connectionId: `connection-${edit.screenId}`,
        heightPinned: false,
      })),
      pendingAgentHandoffBusyRef: { current: false },
      pendingLiveNonStyleEdits: edits,
      stagedHandoffStartTimerRef: { current: undefined },
      stagedSourceHandoffRef,
      pendingStructureVerificationRevisionRef: { current: 0 },
      pendingStructureVerificationSessionRef: sessionRef,
      pendingLiveNonStyleEditsRef: pendingEditsRef,
      pendingStructureVerificationSnapshotsRef: { current: snapshots },
      pendingStructureVerificationStatus: "idle" as const,
      pendingVisualStyleEdits: [],
      pendingVisualStylePrompt: "Apply the pending structure edits.",
      setActiveLeftPanel: vi.fn(),
      setApplyingViaHost: vi.fn(),
      setPendingAgentHandoffBusy: vi.fn(),
      setPendingLiveNonStyleEdits: vi.fn(),
      setPendingStructureAckRequest,
      setPendingStructureVerificationStatus: vi.fn(),
      setPendingVisualStyleBaselineResetRequest: vi.fn(),
      setPendingVisualStyleRevertRequest: vi.fn(),
      setRuntimeStructureVerificationRequest,
      t: (key: string) => key,
    },
    ackRequests,
    cancelPendingStructureVerification,
    clearPendingLiveEditState,
    runtimeRequests,
  };
}

describe("runApplyPendingVisualStylesWithAgent", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    Object.assign(globalThis, {
      window: {
        clearTimeout: globalThis.clearTimeout,
        setTimeout: globalThis.setTimeout,
      },
    });
    callActionMock.mockReset();
    sendDesignSourceHandoffAndConfirmMock.mockClear();
  });

  it("hands off a shared prompt without clearing it before source acknowledgement", async () => {
    const setup = argsFor([], new Map());

    await runApplyPendingVisualStylesWithAgent({
      ...setup.args,
      pendingVisualStylePrompt: "Shared canvas changes",
      allowPromptOnly: true,
    });

    expect(sendDesignSourceHandoffAndConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "Shared canvas changes",
        submit: true,
      }),
      { timeoutMs: 10_000 },
    );
    expect(setup.clearPendingLiveEditState).not.toHaveBeenCalled();
  });

  it("allows long source-write gaps and drains each edit", async () => {
    const edits = [structureEdit(1), structureEdit(2), structureEdit(3)];
    const snapshots = new Map();
    const setup = argsFor(edits, snapshots);
    const applyPromise = runApplyPendingVisualStylesWithAgent(setup.args);

    const wakeAt = async (time: number) => {
      vi.setSystemTime(time);
      await vi.advanceTimersByTimeAsync(PENDING_STRUCTURE_RUNTIME_POLL_MS);
    };
    await vi.advanceTimersByTimeAsync(0);
    await wakeAt(65_000);
    await wakeAt(65_150);
    await wakeAt(100_000);
    await wakeAt(100_150);
    await wakeAt(155_000);
    await wakeAt(155_150);
    await expect(applyPromise).resolves.toBeUndefined();

    expect(setup.cancelPendingStructureVerification).not.toHaveBeenCalled();
    expect(setup.clearPendingLiveEditState).toHaveBeenCalledTimes(1);
    expect(setup.runtimeRequests).toHaveLength(3);
    expect(setup.ackRequests).toHaveLength(3);
    expect(setup.ackRequests.flatMap((request) => request.acks)).toEqual(
      edits.map((edit) => ({
        screenId: edit.screenId,
        requestId: edit.requestId,
        applied: true,
      })),
    );
  });

  it("keeps verification bounded by the hard deadline", async () => {
    const edits = [structureEdit(1)];
    const snapshots = new Map();
    const setup = argsFor(edits, snapshots);
    const applyPromise = runApplyPendingVisualStylesWithAgent(setup.args);

    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(PENDING_STRUCTURE_HARD_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(PENDING_STRUCTURE_RUNTIME_POLL_MS);
    await expect(applyPromise).resolves.toBeUndefined();

    expect(setup.cancelPendingStructureVerification).toHaveBeenCalledWith(
      "conflict",
    );
    expect(setup.clearPendingLiveEditState).not.toHaveBeenCalled();
  });

  it("does not let a hanging source read outlive the hard deadline", async () => {
    const edits = [structureEdit(1)];
    const setup = argsFor(edits, new Map(), { hangReads: true });
    const applyPromise = runApplyPendingVisualStylesWithAgent(setup.args);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PENDING_STRUCTURE_HARD_TIMEOUT_MS);
    await expect(applyPromise).resolves.toBeUndefined();

    expect(setup.cancelPendingStructureVerification).toHaveBeenCalledWith(
      "conflict",
    );
  });

  it("aborts a hanging source read when verification is cancelled", async () => {
    const edits = [structureEdit(1)];
    const setup = argsFor(edits, new Map(), { hangReads: true });
    const applyPromise = runApplyPendingVisualStylesWithAgent(setup.args);

    setup.cancelPendingStructureVerification();
    await expect(applyPromise).resolves.toBeUndefined();

    expect(callActionMock).toHaveBeenCalledWith(
      "read-local-file",
      expect.any(Object),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
