import { describe, expect, it } from "vitest";

import { getEditorActionErrorTranslationKey } from "./editor-action-errors";

describe("getEditorActionErrorTranslationKey", () => {
  it("maps stable editor action codes to localized copy", () => {
    expect(
      getEditorActionErrorTranslationKey({
        errorCode: "slide_source_conflict",
        actionMessage: "Slide slide-private-id changed.",
      }),
    ).toBe("editorErrors.slideChanged");
    expect(
      getEditorActionErrorTranslationKey(
        { errorCode: "slide_source_conflict" },
        "comment-anchor",
      ),
    ).toBe("editorErrors.commentAnchorChanged");
    expect(
      getEditorActionErrorTranslationKey({
        errorCode: "comment_thread_resolved",
      }),
    ).toBe("editorErrors.commentThreadResolved");
  });

  it("does not expose ambiguous or unknown errors as localized messages", () => {
    expect(
      getEditorActionErrorTranslationKey({
        errorCode: "not_found",
        actionMessage: "Comment private-comment-id not found.",
      }),
    ).toBeUndefined();
    expect(
      getEditorActionErrorTranslationKey({
        errorCode: "provider_failure",
        actionMessage: "Internal provider details",
      }),
    ).toBeUndefined();
    expect(
      getEditorActionErrorTranslationKey(new Error("Network dropped")),
    ).toBeUndefined();
  });
});
