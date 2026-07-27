import { describe, expect, it } from "vitest";

import {
  acknowledgeClipboardContentMutation,
  publishClipboardContentMutation,
  type ClipboardContentLineage,
} from "./clipboard-content-lineage";

const lineage = (
  content: string,
  contentHash: string,
  mutationId: number,
): ClipboardContentLineage => ({
  content,
  contentHash,
  mutationId,
  origin: "clipboard-paste",
});

describe("clipboard content lineage", () => {
  it("keeps stale passive echoes from replacing an undo target", () => {
    const undone = lineage("base", "base-hash", 3);
    expect(
      acknowledgeClipboardContentMutation({
        current: undone,
        nextContent: "base + stale clone",
        nextContentHash: "stale-hash",
      }),
    ).toBe(undone);
  });

  it("publishes an ordinary edit immediately after undo", () => {
    const undone = lineage("base", "base-hash", 3);
    expect(
      publishClipboardContentMutation({
        current: undone,
        baseContentHash: "base-hash",
        nextContent: "base + ordinary edit",
        nextContentHash: "edited-hash",
        origin: "user",
      }),
    ).toEqual({
      content: "base + ordinary edit",
      contentHash: "edited-hash",
      mutationId: 4,
      origin: "user",
    });
  });

  it("publishes a new paste immediately after undo", () => {
    const undone = lineage("base", "base-hash", 8);
    expect(
      publishClipboardContentMutation({
        current: undone,
        baseContentHash: "base-hash",
        nextContent: "base + new clone",
        nextContentHash: "clone-hash",
        origin: "clipboard-paste",
      }),
    ).toMatchObject({ mutationId: 9, origin: "clipboard-paste" });
  });

  it("rejects a local mutation computed from a stale generation", () => {
    const undone = lineage("base", "base-hash", 3);
    expect(
      publishClipboardContentMutation({
        current: undone,
        baseContentHash: "stale-hash",
        nextContent: "stale + edit",
        nextContentHash: "stale-edit-hash",
        origin: "user",
      }),
    ).toBeNull();
  });

  it("accepts a matching explicit acknowledgement without regressing ids", () => {
    const current = lineage("base", "base-hash", 3);
    expect(
      acknowledgeClipboardContentMutation({
        current,
        nextContent: "base + clone",
        nextContentHash: "clone-hash",
        publication: {
          mutationId: 4,
          contentHash: "clone-hash",
          origin: "clipboard-paste",
        },
      }),
    ).toEqual({
      content: "base + clone",
      contentHash: "clone-hash",
      mutationId: 4,
      origin: "clipboard-paste",
    });
  });
});
