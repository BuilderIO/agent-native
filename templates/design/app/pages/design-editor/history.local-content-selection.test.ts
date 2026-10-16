import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  mergeLocalContentHistoryFallback,
  stampContentHistorySelectionAfterEntry,
  stampLocalContentHistorySelectionAfter,
  stampLocalContentHistorySelectionBefore,
  type ContentHistoryChange,
  type ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";

describe("local content history selection stamps", () => {
  it("keeps the first selection for undo and advances the redo selection when a change coalesces", () => {
    const firstBefore = {
      selectedElement: null,
      selectedLayerIds: ["original"],
    };
    const firstAfter = {
      selectedElement: null,
      selectedLayerIds: ["first-copy"],
    };
    const latestBefore = {
      selectedElement: null,
      selectedLayerIds: ["first-copy"],
    };
    const latestAfter = {
      selectedElement: null,
      selectedLayerIds: ["second-copy"],
    };
    const entry: ContentHistoryChange = {
      fileId: "file-1",
      before: "<original/>",
      after: "<first-copy/>",
      selectionBefore: firstBefore,
      selectionAfter: firstAfter,
    };
    const stack = mergeLocalContentHistoryFallback([entry], {
      fileId: "file-1",
      before: "<first-copy/>",
      after: "<second-copy/>",
    });
    const top = stack[0]!;

    stampLocalContentHistorySelectionBefore(stack, entry, latestBefore);
    stampLocalContentHistorySelectionAfter(stack, entry, latestAfter);

    expect(top).not.toBe(entry);
    expect(top.selectionBefore).toEqual(firstBefore);
    expect(top.selectionAfter).toEqual(latestAfter);
  });

  it("does nothing when there is no local history entry", () => {
    expect(() =>
      stampLocalContentHistorySelectionAfter([], undefined, {
        selectedElement: null,
        selectedLayerIds: ["copy"],
      }),
    ).not.toThrow();
  });

  it("stamps redo selection onto the exact history entry from a creation batch", () => {
    const entry: ContentHistoryChange = {
      fileId: "screen-1",
      before: "<main></main>",
      after: '<main><div data-agent-native-node-id="vector-a"></div></main>',
    };
    const node = buildCodeLayerProjection(entry.after, {
      source: { kind: "design-file", fileId: entry.fileId },
    }).nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "vector-a",
    );
    if (!node) throw new Error("Created vector is missing from its source");
    const afterMap: ContentHistorySelectionAfterMap = new WeakMap();

    stampContentHistorySelectionAfterEntry(afterMap, entry, {
      overviewSelectedScreenIds: [],
      selectedLayerIds: [node.id],
      activeFileId: entry.fileId,
    });

    expect(afterMap.get(entry)).toMatchObject({
      overviewSelectedScreenIds: [],
      selectedLayerIds: [node.id],
      activeFileId: entry.fileId,
      sourceContentByFileId: { [entry.fileId]: entry.after },
    });
  });
});
