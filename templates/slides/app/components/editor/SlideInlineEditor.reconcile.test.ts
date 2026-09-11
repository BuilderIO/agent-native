import { describe, expect, it } from "vitest";

import { shouldApplySlideContentSync } from "./SlideInlineEditor";

const base = {
  nextContent: "<p>Agent edit</p>",
  currentContent: "<p>Live editor state</p>",
  contentUpdatedAt: "2026-05-29T10:02:00.000Z",
  lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
  isLeadClient: true,
  editorFocused: false,
  lastTypedAt: 0,
  now: 10_000,
};

describe("shouldApplySlideContentSync", () => {
  it("applies a genuinely newer external edit through the lead client", () => {
    expect(shouldApplySlideContentSync(base)).toBe(true);
  });

  it("does not apply a stale poll snapshot over live edits", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        contentUpdatedAt: "2026-05-29T10:00:00.000Z",
        lastAppliedUpdatedAt: "2026-05-29T10:01:00.000Z",
      }),
    ).toBe(false);
  });

  it("does nothing when the editor already reflects the incoming content", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        currentContent: base.nextContent,
      }),
    ).toBe(false);
  });

  it("applies on first open when there is no baseline yet", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        lastAppliedUpdatedAt: null,
      }),
    ).toBe(true);
  });

  it("only the lead client applies the snapshot", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        isLeadClient: false,
      }),
    ).toBe(false);
  });

  it("defers while the user is typing this very moment", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        editorFocused: true,
        lastTypedAt: 9_500, // 500ms ago, within the 1500ms typing window
        now: 10_000,
      }),
    ).toBe(false);
  });

  it("applies once the focused user has paused typing", () => {
    expect(
      shouldApplySlideContentSync({
        ...base,
        editorFocused: true,
        lastTypedAt: 0, // long ago — past the typing window
        now: 10_000,
      }),
    ).toBe(true);
  });
});
