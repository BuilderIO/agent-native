import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

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

function publish(args: {
  current: ClipboardContentLineage | undefined;
  baseContentHash: string;
  nextContent: string;
  origin: "user" | "clipboard-paste" | "clipboard-undo" | "clipboard-redo";
  baseSource?: "lineage" | "document";
}) {
  return publishClipboardContentMutation({
    fileId: "test.txt",
    fileType: "text",
    ...args,
  });
}

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
      publish({
        current: undone,
        baseContentHash: "base-hash",
        nextContent: "base + ordinary edit",
        origin: "user",
      }),
    ).toEqual({
      content: "base + ordinary edit",
      contentHash: sourceContentHash("base + ordinary edit"),
      mutationId: 4,
      origin: "user",
    });
  });

  it("publishes a new paste immediately after undo", () => {
    const undone = lineage("base", "base-hash", 8);
    expect(
      publish({
        current: undone,
        baseContentHash: "base-hash",
        nextContent: "base + new clone",
        origin: "clipboard-paste",
      }),
    ).toMatchObject({ mutationId: 9, origin: "clipboard-paste" });
  });

  it("rejects a local mutation computed from a stale generation", () => {
    const undone = lineage("base", "base-hash", 3);
    expect(
      publish({
        current: undone,
        baseContentHash: "stale-hash",
        nextContent: "stale + edit",
        origin: "user",
      }),
    ).toBeNull();
  });

  it("supersedes a lineage the document has already moved past", () => {
    const beforeDelete = lineage("base + rect", "pre-delete-hash", 3);
    expect(
      publish({
        current: beforeDelete,
        baseContentHash: "post-delete-hash",
        nextContent: "base + pasted copy",
        origin: "clipboard-paste",
        baseSource: "document",
      }),
    ).toEqual({
      content: "base + pasted copy",
      contentHash: sourceContentHash("base + pasted copy"),
      mutationId: 4,
      origin: "clipboard-paste",
    });
  });

  it("publishes canonical bytes and hashes before paste undo/redo acknowledgement", () => {
    const rawContent =
      '<!doctype html><html><body><button class="copy">Clone</button></body></html>';
    const fileId = "screen-a";
    const fileType = "html";
    const canonicalContent = prepareCanonicalSourceContent(rawContent, {
      fileId,
      fileType,
    }).content;
    expect(canonicalContent).not.toBe(rawContent);

    const publication = publishClipboardContentMutation({
      current: undefined,
      baseContentHash: sourceContentHash("<html><body></body></html>"),
      fileId,
      fileType,
      nextContent: rawContent,
      origin: "clipboard-paste",
    });
    expect(publication).toMatchObject({
      content: canonicalContent,
      contentHash: sourceContentHash(canonicalContent),
      mutationId: 1,
      origin: "clipboard-paste",
    });
    expect(publication?.contentHash).not.toBe(sourceContentHash(rawContent));

    const acknowledged = acknowledgeClipboardContentMutation({
      current: undefined,
      nextContent: canonicalContent,
      nextContentHash: sourceContentHash(canonicalContent),
      publication: publication ?? undefined,
    });
    expect(acknowledged?.content).toBe(canonicalContent);
    expect(acknowledged?.contentHash).toBe(sourceContentHash(canonicalContent));
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
