// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  peekPendingTextCapture,
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

// The ladder stops at the FIRST live session, so a creation the user walks away
// from afterwards has nothing left running to judge its node.
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
      // After the caller has recorded the pending entry, as the real ladder's
      // first attempt would.
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
  // Still delivering the escaped text, so the ladder may keep asking.
  expect(ladderIsAbandoned?.()).toBe(false);

  // The frame committed "Sta" and closed the session. Completion skips the
  // stand-down teardown, and a retry still inside the ladder window used to
  // force the committed node straight back into an edit session.
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
  // A live session is the user still typing, not an abandoned node.
  expect(isTextEditSessionOutcome(ladderOutcome)).toBe(true);
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  // They point away instead. Nothing else will ever decide this node's fate.
  window.dispatchEvent(new PointerEvent("pointerdown"));
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  // The blur-commit gets the rest of the request window before content decides.
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
  // The ladder settled on that first live session and stops judging the node.
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

  // The frame took the request, then the user escaped or blurred out of an
  // empty session: DesignEditor cancels this creation's ladder, which is now
  // the only thing that can decide the node's fate.
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

  // Typed immediately, escaped before POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS —
  // the window where the keystrokes are still host-side and no session exists.
  for (const char of "Sta") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
  vi.advanceTimersByTime(200);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );

  // Escape keeps the text: the owner that mounts next is asked to open the
  // session, land "Sta" and close it, and the node is never treated as
  // abandoned.
  const begun = vi.fn(() => true);
  registerTextEditOwner("board", begun);
  expect(begun).toHaveBeenCalledExactlyOnceWith("text-1", {
    commitImmediately: true,
  });
  // Owed, not intercepting: the text stays here until the frame takes it.
  expect(peekPendingTextCapture("board", "text-1")).toBe("Sta");

  vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();
});
