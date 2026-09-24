import { describe, expect, it } from "vitest";

import {
  areComposerContextItemsReady,
  snapshotComposerContextItems,
} from "./context-items.js";

describe("persisted reference status", () => {
  it("permits steering with a failed persisted source while preserving its honest status", () => {
    const item = {
      key: "system-source:source-one",
      title: "Source",
      context: "systemId=qa, sourceId=source-one",
      status: "error" as const,
      statusMessage: "Read failed",
      removable: false,
      blocksSubmission: false,
    };
    expect(areComposerContextItemsReady([item])).toBe(true);
    expect(snapshotComposerContextItems([item])).toEqual([item]);
  });
  it.each(["pending", "error"] as const)(
    "still blocks a normal %s upload/context",
    (status) => {
      const item = { key: "upload", title: "Upload", context: "", status };
      expect(areComposerContextItemsReady([item])).toBe(false);
      expect(() => snapshotComposerContextItems([item])).toThrow("not ready");
    },
  );
});
