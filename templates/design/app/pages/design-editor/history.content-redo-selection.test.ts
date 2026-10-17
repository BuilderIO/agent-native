import { describe, expect, it } from "vitest";

import {
  captureContentUndoStackTop,
  type ContentHistoryChange,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  getContentHistoryChanges,
  stampContentHistorySelectionAfter,
} from "@/pages/design-editor/history";

const selection = (layerIds: string[]) => ({
  overviewSelectedScreenIds: [],
  selectedLayerIds: layerIds,
  activeFileId: "file-1",
});

describe("captureContentUndoStackTop / stampContentHistorySelectionAfter", () => {
  it("stamps the after-selection onto the entry a write actually pushed", () => {
    const stack: ContentHistoryEntry[] = [];
    const afterMap: ContentHistorySelectionAfterMap = new WeakMap();
    const before = captureContentUndoStackTop(stack);

    const pushed: ContentHistoryEntry = {
      fileId: "file-1",
      before: "<a/><b/>",
      after: "<group/>",
    };
    stack.push(pushed);

    stampContentHistorySelectionAfter(
      stack,
      afterMap,
      before,
      selection(["group-1"]),
    );

    expect(afterMap.get(pushed)).toMatchObject(selection(["group-1"]));
  });

  it("leaves an older entry's stamp untouched when no new entry was pushed (coalesced or no-op write)", () => {
    const existing: ContentHistoryEntry = {
      fileId: "file-1",
      before: "<a/>",
      after: "<a moved/>",
    };
    const stack: ContentHistoryEntry[] = [existing];
    const afterMap: ContentHistorySelectionAfterMap = new WeakMap();
    afterMap.set(existing, selection(["earlier"]));
    const before = captureContentUndoStackTop(stack);

    stampContentHistorySelectionAfter(
      stack,
      afterMap,
      before,
      selection(["should-not-apply"]),
    );

    expect(afterMap.get(existing)).toEqual(selection(["earlier"]));
  });

  it("is a no-op when nothing landed on this stack at all (e.g. the write went through Yjs instead)", () => {
    const stack: ContentHistoryEntry[] = [];
    const afterMap: ContentHistorySelectionAfterMap = new WeakMap();
    const before = captureContentUndoStackTop(stack);

    expect(() =>
      stampContentHistorySelectionAfter(
        stack,
        afterMap,
        before,
        selection(["x"]),
      ),
    ).not.toThrow();
  });

  it("stops applying once file-deletion pruning reallocates a grouped entry's object (documented degrade-to-before, not a wrong-entry attach)", () => {
    const changes: ContentHistoryChange[] = [
      { fileId: "file-1", before: "<a/>", after: "<group/>" },
      { fileId: "file-2", before: "<c/>", after: "<c/>" },
    ];
    const original: ContentHistoryEntry = { changes };
    const afterMap: ContentHistorySelectionAfterMap = new WeakMap();
    afterMap.set(original, selection(["group-1"]));

    const rebuilt: ContentHistoryEntry = {
      changes: getContentHistoryChanges(original).slice(),
    };

    expect(afterMap.get(rebuilt)).toBeUndefined();
    expect(afterMap.get(original)).toEqual(selection(["group-1"]));
  });
});
