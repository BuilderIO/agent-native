// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  failPendingTextCapture,
  HOST_COMMIT_RETRY_DELAYS_MS,
  peekPendingTextCapture,
  registerPendingTextHostCommit,
  registerTextEditOwner,
  releasePendingTextCapture,
} from "@/components/design/design-canvas/pending-text-capture";
import { PENDING_TEXT_EDIT_TIMEOUT_MS } from "@/components/design/design-canvas/pending-text-edit";
import {
  isTextEditSessionOutcome,
  type BeginTextEditOutcome,
} from "@/pages/design-editor/text-edit-utils";

import {
  runPrimitiveCreated,
  type PrimitiveCreatedArgs,
} from "./primitive-created";

let ladderOutcome: BeginTextEditOutcome = "active";
let ladderIsAbandoned: (() => boolean) | undefined;
vi.mock("@/pages/design-editor/text-edit-utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/pages/design-editor/text-edit-utils")
    >();
  return {
    ...actual,
    scheduleBeginTextEditForScreen: (
      _screenId: string | null,
      _nodeId: string,
      options?: {
        isAbandoned?: () => boolean;
        onExhausted?: (status: BeginTextEditOutcome) => void;
      },
    ) => {
      ladderIsAbandoned = options?.isAbandoned;
      window.setTimeout(() => options?.onExhausted?.(ladderOutcome), 0);
      return () => {};
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

it("stops the ladder asking for activation once the frame has committed the text", () => {
  vi.useFakeTimers();
  ladderOutcome = "not-editing";
  runPrimitiveCreated(createArgs(vi.fn()), "board", "text-1");
  for (const char of "Sta") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
  expect(ladderIsAbandoned?.()).toBe(false);

  releasePendingTextCapture("board", "text-1");
  expect(ladderIsAbandoned?.()).toBe(true);
});

function createArgs(
  removeEmptyTextNodeWithRetry: (
    screenId: string | null,
    nodeId: string,
  ) => void,
): PrimitiveCreatedArgs {
  const noop = () => {};
  return {
    activeLeftPanel: "file",
    boardFileId: "board",
    clearPendingOverviewLayerSelectionTimer: noop,
    pendingEmptyTextEditRef: { current: null },
    pendingOverviewLayerSelectionRef: { current: null },
    pendingOverviewScreenSelectionRef: { current: null },
    pendingTextEditNodeIdRef: { current: "text-1" },
    layersRevealedForFirstCreateRef: { current: true },
    removeEmptyTextNodeWithRetry,
    setActiveFileId: noop,
    setActiveLeftPanel: noop,
    setActiveTool: noop,
    setCreatedOverviewLayerSelection: noop,
    setHoveredElement: noop,
    setMode: noop,
    setOverviewSelectedScreenIds: noop,
    setSelectedElement: noop,
    setSelectedLayerIdsState: noop,
  };
}

it("cleans up an abandoned empty creation whose session was already live", () => {
  vi.useFakeTimers();
  ladderOutcome = "active";
  const removeEmptyTextNodeWithRetry = vi.fn();
  runPrimitiveCreated(
    createArgs(removeEmptyTextNodeWithRetry),
    "board",
    "text-1",
  );

  vi.advanceTimersByTime(1);
  expect(isTextEditSessionOutcome(ladderOutcome)).toBe(true);
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  window.dispatchEvent(new PointerEvent("pointerdown"));
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).toHaveBeenCalledExactlyOnceWith(
    "board",
    "text-1",
  );
});

it("cleans an abandoned creation up exactly once when the ladder also exhausts", () => {
  vi.useFakeTimers();
  ladderOutcome = "no-iframe";
  const removeEmptyTextNodeWithRetry = vi.fn();
  runPrimitiveCreated(
    createArgs(removeEmptyTextNodeWithRetry),
    "board",
    "text-1",
  );

  window.dispatchEvent(new PointerEvent("pointerdown"));
  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).toHaveBeenCalledExactlyOnceWith(
    "board",
    "text-1",
  );
});

it("removes the node when Escape lands inside the activation delay with nothing typed", () => {
  vi.useFakeTimers();
  ladderOutcome = "not-editing";
  const removeEmptyTextNodeWithRetry = vi.fn();
  runPrimitiveCreated(
    createArgs(removeEmptyTextNodeWithRetry),
    "board",
    "text-1",
  );

  vi.advanceTimersByTime(200);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );

  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).toHaveBeenCalledExactlyOnceWith(
    "board",
    "text-1",
  );
});

it("cleans up an empty node whose session opened and then ended", () => {
  vi.useFakeTimers();
  ladderOutcome = "active";
  const removeEmptyTextNodeWithRetry = vi.fn();
  const args = createArgs(removeEmptyTextNodeWithRetry);
  runPrimitiveCreated(args, "board", "text-1");

  vi.advanceTimersByTime(1);
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  releasePendingTextCapture("board", "text-1");
  args.pendingEmptyTextEditRef.current?.cancel();

  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).toHaveBeenCalledExactlyOnceWith(
    "board",
    "text-1",
  );
});

it("keeps the node and commits the keystrokes when Escape lands after typing", () => {
  vi.useFakeTimers();
  ladderOutcome = "not-editing";
  const removeEmptyTextNodeWithRetry = vi.fn();
  runPrimitiveCreated(
    createArgs(removeEmptyTextNodeWithRetry),
    "board",
    "text-1",
  );

  for (const char of "Sta") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
  vi.advanceTimersByTime(200);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );

  const begun = vi.fn(() => true);
  registerTextEditOwner("board", begun);
  expect(begun).toHaveBeenCalledExactlyOnceWith("text-1", {
    commitImmediately: true,
  });
  expect(peekPendingTextCapture("board", "text-1")).toBe("Sta");

  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();
});

it("keeps the node while a queued host write still owes it text", () => {
  vi.useFakeTimers();
  ladderOutcome = "node-missing";
  const removeEmptyTextNodeWithRetry = vi.fn();
  const commit = vi
    .fn<(screenId: string, nodeId: string, text: string) => boolean>()
    .mockImplementationOnce(() => false)
    .mockImplementationOnce(() => true);
  const unregisterCommit = registerPendingTextHostCommit(commit);
  try {
    runPrimitiveCreated(
      createArgs(removeEmptyTextNodeWithRetry),
      "board",
      "text-1",
    );
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }

    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);
    expect(commit.mock.calls).toEqual([
      ["board", "text-1", "Sta"],
      ["board", "text-1", "Sta"],
    ]);
    expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();
  } finally {
    unregisterCommit();
  }
});

it("cleans the node up when the failure leaves nothing owed", () => {
  vi.useFakeTimers();
  ladderOutcome = "node-missing";
  const removeEmptyTextNodeWithRetry = vi.fn();
  const commit = vi.fn(() => true);
  const unregisterCommit = registerPendingTextHostCommit(commit);
  try {
    runPrimitiveCreated(
      createArgs(removeEmptyTextNodeWithRetry),
      "board",
      "text-1",
    );

    vi.advanceTimersByTime(1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(removeEmptyTextNodeWithRetry).toHaveBeenCalledExactlyOnceWith(
      "board",
      "text-1",
    );
  } finally {
    unregisterCommit();
  }
});

it("keeps the node when a rolled-back save's write is still retrying", () => {
  vi.useFakeTimers();
  ladderOutcome = "node-missing";
  const removeEmptyTextNodeWithRetry = vi.fn();
  const commit = vi
    .fn<(screenId: string, nodeId: string, text: string) => boolean>()
    .mockImplementationOnce(() => false)
    .mockImplementationOnce(() => true);
  const unregisterCommit = registerPendingTextHostCommit(commit);
  try {
    runPrimitiveCreated(
      createArgs(removeEmptyTextNodeWithRetry),
      "board",
      "text-1",
    );
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }

    failPendingTextCapture("board");
    expect(commit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);
    expect(commit.mock.calls).toEqual([
      ["board", "text-1", "Sta"],
      ["board", "text-1", "Sta"],
    ]);
    expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();
  } finally {
    unregisterCommit();
  }
});

it("never deletes the node before a rolled-back save's write lands", () => {
  vi.useFakeTimers();
  ladderOutcome = "node-missing";
  const order: string[] = [];
  const removeEmptyTextNodeWithRetry = vi.fn(() => {
    order.push("cleanup");
  });
  const commit = vi.fn(() => {
    order.push("commit");
    return true;
  });
  const unregisterCommit = registerPendingTextHostCommit(commit);
  try {
    runPrimitiveCreated(
      createArgs(removeEmptyTextNodeWithRetry),
      "board",
      "text-1",
    );
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }

    failPendingTextCapture("board");
    expect(commit).toHaveBeenCalledExactlyOnceWith("board", "text-1", "Sta");

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);

    expect(order[0]).toBe("commit");
  } finally {
    unregisterCommit();
  }
});
