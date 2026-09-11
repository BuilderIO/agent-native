import { describe, expect, it } from "vitest";

import {
  resolvePresentEscapeAction,
  shouldBlockPresentPageNavigation,
} from "./present-review-state";

describe("present review keyboard state", () => {
  it("closes the comments sheet before leaving presentation mode", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: true, commentMode: false }),
    ).toBe("close-comments");
  });

  it("defers Escape to the staged pin composer while comment mode is active", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: false, commentMode: true }),
    ).toBe("defer-to-comment-mode");
  });

  it("leaves presentation mode only when no review UI is active", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: false, commentMode: false }),
    ).toBe("exit-presentation");
  });

  it("blocks slide navigation while either review surface is active", () => {
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: true,
        commentMode: false,
      }),
    ).toBe(true);
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: false,
        commentMode: true,
      }),
    ).toBe(true);
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: false,
        commentMode: false,
      }),
    ).toBe(false);
  });
});
