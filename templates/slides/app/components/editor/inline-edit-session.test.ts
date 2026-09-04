import { describe, expect, it } from "vitest";

import {
  shouldPersistInlineEditContent,
  type InlineEditContentSnapshot,
} from "./inline-edit-session";

const initial: InlineEditContentSnapshot = {
  slideId: "slide-1",
  content: '<h1 class="title">Keep the layout</h1>',
};

describe("inline edit session", () => {
  it("does not persist a no-op edit", () => {
    expect(shouldPersistInlineEditContent(initial, { ...initial })).toBe(false);
  });

  it("does not replay content already captured by the latest draft", () => {
    const latestDraft = { ...initial, content: "<h1>Latest</h1>" };
    expect(shouldPersistInlineEditContent(latestDraft, latestDraft)).toBe(
      false,
    );
  });

  it("persists changed content", () => {
    expect(
      shouldPersistInlineEditContent(initial, {
        ...initial,
        content: '<h1 class="title">Updated copy</h1>',
      }),
    ).toBe(true);
  });

  it("persists when the initial snapshot is unavailable", () => {
    expect(shouldPersistInlineEditContent(null, initial)).toBe(true);
  });

  it("does not persist when there is no current content", () => {
    expect(shouldPersistInlineEditContent(initial, null)).toBe(false);
  });
});
