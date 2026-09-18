import { describe, expect, it, vi } from "vitest";

import { runScreenTextContentChange } from "./screen-text-content-change";

const html =
  '<section data-agent-native-node-id="component-root" data-agent-native-component-ref="button"><span id="label" data-agent-native-node-id="label">Before</span></section>';

function args(overrides: Record<string, unknown> = {}) {
  return {
    activeFile: {
      id: "active-file",
      filename: "active.html",
      fileType: "html",
      content: "",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    },
    applyFileContentUpdate: vi.fn(() => ({ status: "accepted" })),
    applyLinkedComponentEdit: vi.fn(),
    canEditDesign: true,
    designSourceType: "inline" as const,
    prepareTextCreationFinalization: vi.fn(() => ({
      isCreationCommit: false,
      historyHandled: false,
      confirm: () => {},
    })),
    getScreenContent: vi.fn(() => html),
    // Returns a real status: the `as unknown as Parameters<…>` cast below
    // would have let a void stub through until it failed somewhere else.
    handleTextContentChange: vi.fn(() => "accepted" as const),
    liveScreenSnapshotsById: {},
    overviewScreens: [
      { id: "screen-1", sourceType: "inline", heightPinned: false },
    ],
    recordPendingLiveTextEdit: vi.fn(),
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setMode: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    t: (key: string) => key,
    updateLiveScreenSnapshotContent: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof runScreenTextContentChange>[0];
}

describe("overview linked text edits", () => {
  it("routes an inline linked instance through the shared component action", () => {
    const fixture = args();

    runScreenTextContentChange(fixture, "screen-1", "span#label", "After", {
      tagName: "span",
      selector: "span#label",
      sourceId: "label",
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 80, height: 20 },
      isFlexChild: false,
      isFlexContainer: false,
    });

    expect(fixture.applyLinkedComponentEdit).toHaveBeenCalledWith(
      "screen-1",
      "label",
      { kind: "textContent", value: "After" },
    );
    expect(fixture.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(fixture.setActiveFileId).toHaveBeenCalledWith("screen-1");
  });

  it("keeps localhost text edits in the pending live source handoff", () => {
    const recordPendingLiveTextEdit = vi.fn();
    const fixture = args({
      overviewScreens: [
        { id: "screen-1", sourceType: "localhost", heightPinned: false },
      ],
      recordPendingLiveTextEdit,
    });

    runScreenTextContentChange(fixture, "screen-1", "#label", "After");

    expect(recordPendingLiveTextEdit).toHaveBeenCalledWith(
      "screen-1",
      "#label",
      "After",
      undefined,
      undefined,
    );
    expect(fixture.applyLinkedComponentEdit).not.toHaveBeenCalled();
    expect(fixture.applyFileContentUpdate).not.toHaveBeenCalled();
  });
});
