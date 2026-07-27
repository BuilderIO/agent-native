import { describe, expect, it, vi } from "vitest";

import {
  composerDraftStorageKey,
  promptToComposerDraftHtml,
  savePromptToComposerDraft,
} from "./composer-draft";

describe("composer draft helpers", () => {
  it("formats prompts as the composer draft html", () => {
    expect(promptToComposerDraftHtml("Title\n\nUse <b>bold</b> & data")).toBe(
      "<p>Title</p><p>Use &lt;b&gt;bold&lt;/b&gt; &amp; data</p>",
    );
  });

  it("keeps empty prompts as empty drafts", () => {
    expect(promptToComposerDraftHtml(" \n ")).toBe("");
  });

  it("stores prompts under the encoded draft scope", () => {
    const storage = { setItem: vi.fn() } as unknown as Storage;

    expect(
      savePromptToComposerDraft("slides new/deck", "Try again", storage),
    ).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      composerDraftStorageKey("slides new/deck"),
      "<p>Try again</p>",
    );
  });

  it("reports storage failures", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    } as unknown as Storage;

    expect(
      savePromptToComposerDraft("slides-new-deck", "Try again", storage),
    ).toBe(false);
  });
});
