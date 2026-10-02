import { describe, expect, it } from "vitest";

import { composerDraftSnapshot, sameComposerDraft } from "./TiptapComposer.js";

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
