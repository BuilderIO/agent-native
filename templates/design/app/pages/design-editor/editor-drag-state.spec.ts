import { describe, expect, it } from "vitest";

import { shouldAcceptEditorDragStateEvent } from "./editor-drag-state";

describe("editor drag state ownership", () => {
  it("rejects a delayed source-screen event after an A-to-B handoff", () => {
    const retiredDragIds = new Set<string>();
    const retiredScreenIds = new Set<string>();
    const dragId = "drag-1";

    expect(
      shouldAcceptEditorDragStateEvent(
        { active: true, dragId, screenId: "screen-a", eventAt: 10 },
        { dragId: null, retiredDragIds, retiredScreenIds },
      ),
    ).toBe(true);

    retiredScreenIds.add("screen-a");
    expect(
      shouldAcceptEditorDragStateEvent(
        { active: true, dragId, screenId: "screen-b", eventAt: 20 },
        { dragId, retiredDragIds, retiredScreenIds, latestEventAt: 10 },
      ),
    ).toBe(true);
    expect(
      shouldAcceptEditorDragStateEvent(
        {
          active: true,
          dragId,
          screenId: "screen-a",
          eventAt: 20,
          preview: { phase: "preview" },
        },
        { dragId, retiredDragIds, retiredScreenIds, latestEventAt: 20 },
      ),
    ).toBe(false);
    expect(
      shouldAcceptEditorDragStateEvent(
        {
          active: true,
          dragId,
          screenId: "screen-a",
          eventAt: 30,
          preview: { phase: "clear" },
        },
        { dragId, retiredDragIds, retiredScreenIds, latestEventAt: 20 },
      ),
    ).toBe(true);
    expect(
      shouldAcceptEditorDragStateEvent(
        { active: true, dragId, screenId: "screen-a", eventAt: 30 },
        { dragId, retiredDragIds, retiredScreenIds, latestEventAt: 20 },
      ),
    ).toBe(false);
    retiredScreenIds.clear();
    expect(
      shouldAcceptEditorDragStateEvent(
        { active: true, dragId: "drag-2", screenId: "screen-a", eventAt: 30 },
        { dragId: null, retiredDragIds, retiredScreenIds },
      ),
    ).toBe(true);
  });
});
