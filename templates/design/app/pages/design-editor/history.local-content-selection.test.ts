import { describe, expect, it } from "vitest";

import {
  stampLocalContentHistorySelectionAfter,
  stampLocalContentHistorySelectionBefore,
  type ContentHistoryChange,
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
      after: "<second-copy/>",
      selectionBefore: firstBefore,
      selectionAfter: firstAfter,
    };

    stampLocalContentHistorySelectionBefore([entry], entry, latestBefore);
    stampLocalContentHistorySelectionAfter([entry], entry, latestAfter);

    expect(entry.selectionBefore).toEqual(firstBefore);
    expect(entry.selectionAfter).toEqual(latestAfter);
  });

  it("does nothing when there is no local history entry", () => {
    expect(() =>
      stampLocalContentHistorySelectionAfter([], undefined, {
        selectedElement: null,
        selectedLayerIds: ["copy"],
      }),
    ).not.toThrow();
  });
});
