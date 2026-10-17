// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  acknowledgePendingTextInsert,
  beginPendingTextDelivery,
  releasePendingTextCapture,
  takePendingTextCapture,
} from "@/components/design/design-canvas/pending-text-capture";
import { PENDING_TEXT_EDIT_TIMEOUT_MS } from "@/components/design/design-canvas/pending-text-edit";
import { runPrimitiveCreated } from "@/pages/design-editor/commands/primitive-created";
import type { PrimitiveCreatedArgs } from "@/pages/design-editor/commands/primitive-created";
import {
  commitAfterPaint,
  flushCommitsAfterPaint,
} from "@/pages/design-editor/commit-after-paint";
import { endedTextEditMatchesPendingCreation } from "@/pages/design-editor/text-edit-utils";

const nodeId = "text-1";

afterEach(() => {
  releasePendingTextCapture("board", nodeId);
  releasePendingTextCapture("screen", nodeId);
  flushCommitsAfterPaint();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["board", "screen"])(
  "%s retains typed text when ended state precedes deferred source publication",
  async (owner) => {
    vi.useFakeTimers();
    let savedText = "";
    let removed = false;
    const removeEmptyTextNodeWithRetry = vi.fn(() => {
      if (!savedText) removed = true;
    });
    const args = createArgs(removeEmptyTextNodeWithRetry);

    runPrimitiveCreated(args, owner, nodeId);
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }

    await vi.advanceTimersByTimeAsync(300);

    const handedOff = takePendingTextCapture(owner, nodeId);
    expect(handedOff).toBe("Sta");
    if (handedOff === null) throw new Error("Expected captured text delivery");
    expect(beginPendingTextDelivery(owner, nodeId, handedOff)?.text).toBe(
      "Sta",
    );
    acknowledgePendingTextInsert(owner, nodeId, true);
    commitAfterPaint(() => {
      savedText = "Sta";
    });

    const endedState = { active: false, screenId: owner, sourceId: nodeId };
    expect(
      endedTextEditMatchesPendingCreation(
        args.pendingEmptyTextEditRef.current,
        endedState,
      ),
    ).toBe(true);
    args.pendingEmptyTextEditRef.current?.cancel();

    expect(removed).toBe(false);
    expect(removeEmptyTextNodeWithRetry).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(17);
    expect(savedText).toBe("Sta");
    await vi.advanceTimersByTimeAsync(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(removed).toBe(false);
  },
);

it("still removes an empty creation when Escape cancels the capture", async () => {
  vi.useFakeTimers();
  let removed = false;
  const removeEmptyTextNodeWithRetry = vi.fn(() => {
    removed = true;
  });

  runPrimitiveCreated(
    createArgs(removeEmptyTextNodeWithRetry),
    "board",
    nodeId,
  );
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );

  await vi.advanceTimersByTimeAsync(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
  expect(removeEmptyTextNodeWithRetry).toHaveBeenCalled();
  expect(removed).toBe(true);
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
    pendingTextEditNodeIdRef: { current: nodeId },
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
