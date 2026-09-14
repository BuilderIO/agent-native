import { describe, expect, it } from "vitest";

import {
  inlineEditDraftNeedsPersistence,
  shouldPersistInlineEditContent,
  type InlineEditContentSnapshot,
} from "./inline-edit-session";

const initial: InlineEditContentSnapshot = {
  slideId: "slide-1",
  content: '<h1 class="title">Keep the layout</h1>',
};

describe("inline edit session", () => {
  it("queues the final content when it differs from the latest captured draft", () => {
    const captured = { ...initial, content: "before" };
    const final = { ...initial, content: "before after" };

    expect(inlineEditDraftNeedsPersistence(captured, final, initial)).toBe(
      true,
    );
    expect(inlineEditDraftNeedsPersistence(final, final, initial)).toBe(false);
    expect(
      inlineEditDraftNeedsPersistence(
        { ...captured, slideId: "slide-2" },
        final,
        initial,
      ),
    ).toBe(false);
  });

  it("persists an uncaptured changed draft but not an uncaptured no-op", () => {
    const final = { ...initial, content: "<h1>Latest</h1>" };

    expect(inlineEditDraftNeedsPersistence(null, final, initial)).toBe(true);
    expect(inlineEditDraftNeedsPersistence(null, initial, initial)).toBe(false);
  });

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
