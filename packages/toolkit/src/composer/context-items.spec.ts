import { describe, expect, it } from "vitest";

import {
  areComposerContextItemsReady,
  snapshotComposerContextItems,
  COMPOSER_CONTEXT_MAX_BYTES,
  COMPOSER_CONTEXT_MAX_ITEMS,
} from "./context-items.js";

describe("persisted reference status", () => {
  it("enforces item count and serialized UTF-8 byte limits without dropping fields", () => {
    const item = { key: "brief", title: "Brief", context: "" };
    expect(
      snapshotComposerContextItems(
        Array.from({ length: COMPOSER_CONTEXT_MAX_ITEMS }, () => item),
      ),
    ).toHaveLength(COMPOSER_CONTEXT_MAX_ITEMS);
    expect(() =>
      snapshotComposerContextItems(
        Array.from({ length: COMPOSER_CONTEXT_MAX_ITEMS + 1 }, () => item),
      ),
    ).toThrow("item limit");
    const overhead = new TextEncoder().encode(JSON.stringify([item])).length;
    const exact = {
      ...item,
      context: "x".repeat(COMPOSER_CONTEXT_MAX_BYTES - overhead),
    };
    expect(snapshotComposerContextItems([exact])[0].context).toBe(
      exact.context,
    );
    expect(() =>
      snapshotComposerContextItems([
        { ...exact, context: exact.context + "x" },
      ]),
    ).toThrow("size limit");
    expect(() =>
      snapshotComposerContextItems([
        { ...item, context: "界".repeat(COMPOSER_CONTEXT_MAX_BYTES / 2) },
      ]),
    ).toThrow("size limit");
    expect(() =>
      snapshotComposerContextItems([
        { ...item, statusMessage: "x".repeat(COMPOSER_CONTEXT_MAX_BYTES) },
      ]),
    ).toThrow("size limit");
  });
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
