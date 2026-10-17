import { describe, expect, it } from "vitest";

import { composerDraftSnapshot, sameComposerDraft } from "./TiptapComposer.js";

const baseReference = {
  type: "mention",
  path: "docs/brief.md",
  name: "brief.md",
  source: "workspace",
  refType: "document",
  refId: "brief-1",
  slotKey: "brief",
  slotLabel: "Brief",
  metadata: { owner: "alice", pages: [1, 2] },
} as const;

describe("composer draft snapshot reference identity", () => {
  const withReferences = (
    references: Parameters<typeof composerDraftSnapshot>[1],
  ) => composerDraftSnapshot("Make a deck", references, []);

  it("treats the same reference payload as the same draft, whatever its key order", () => {
    const reordered = {
      metadata: { pages: [1, 2], owner: "alice" },
      slotLabel: "Brief",
      slotKey: "brief",
      refId: "brief-1",
      refType: "document",
      source: "workspace",
      name: "brief.md",
      path: "docs/brief.md",
      type: "mention",
    } as const;

    expect(
      sameComposerDraft(
        withReferences([baseReference]),
        withReferences([reordered]),
      ),
    ).toBe(true);
  });

  it.each([
    ["type", { type: "file" }],
    ["path", { path: "docs/other.md" }],
    ["name", { name: "other.md" }],
    ["source", { source: "drive" }],
    ["refType", { refType: "folder" }],
    ["refId", { refId: "brief-2" }],
    ["slotKey", { slotKey: "outline" }],
    ["slotLabel", { slotLabel: "Outline" }],
    ["metadata", { metadata: { owner: "bob", pages: [1, 2] } }],
    ["nested metadata", { metadata: { owner: "alice", pages: [1, 3] } }],
  ] as const)(
    "is not the same draft when a reference's %s changes",
    (_field, change) => {
      expect(
        sameComposerDraft(
          withReferences([baseReference]),
          withReferences([{ ...baseReference, ...change }]),
        ),
      ).toBe(false);
    },
  );

  it("is not the same draft when a reference is added or removed", () => {
    expect(
      sameComposerDraft(
        withReferences([baseReference]),
        withReferences([baseReference, { ...baseReference, refId: "x" }]),
      ),
    ).toBe(false);
  });
});

describe("composer draft snapshot identity", () => {
  const snapshot = (attachments: Parameters<typeof composerDraftSnapshot>[2]) =>
    composerDraftSnapshot("Make a deck", [], attachments);

  it("treats the same attachment as the same draft", () => {
    const file = new File(["brief"], "brief.pdf");

    expect(
      sameComposerDraft(
        snapshot([{ id: "brief.pdf", name: "brief.pdf", file }]),
        snapshot([{ id: "brief.pdf", name: "brief.pdf", file }]),
      ),
    ).toBe(true);
  });

  it("tells a replacement file with the same name and id from the original", () => {
    const original = new File(["old"], "brief.pdf");
    const replacement = new File(["new content"], "brief.pdf");

    expect(
      sameComposerDraft(
        snapshot([{ id: "brief.pdf", name: "brief.pdf", file: original }]),
        snapshot([{ id: "brief.pdf", name: "brief.pdf", file: replacement }]),
      ),
    ).toBe(false);
  });

  it("falls back to the id or name for an attachment with no file", () => {
    expect(snapshot([{ id: "a" }]).attachmentIds).toEqual(["a"]);
    expect(snapshot([{ name: "b.txt" }]).attachmentIds).toEqual(["b.txt"]);
  });
});
