import { describe, expect, it } from "vitest";

import { getEditorExportErrorTranslationKey } from "./editor-export-errors";

describe("getEditorExportErrorTranslationKey", () => {
  it("maps known action and runtime errors to localized copy", () => {
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "not_authenticated",
        actionMessage: "Sensitive auth details",
      }),
    ).toBe("editorErrors.signInRequired");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "deck_not_found",
        actionMessage: "Deck private-id not found",
      }),
    ).toBe("editorErrors.deckNotFound");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "source_runtime_export_required",
        actionMessage: "Slide private-id needs rendering",
      }),
    ).toBe("editorExport.sourceRuntimeExportUnavailable");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "pptx_image_unavailable",
        actionMessage: "Sensitive image URL details",
      }),
    ).toBe("editorExport.pptxImageUnavailable");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "export_revision_stale",
      }),
    ).toBe("editorErrors.deckChanged");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "invalid_deck_slide_order",
      }),
    ).toBe("editorErrors.deckDataUnavailable");
    expect(
      getEditorExportErrorTranslationKey({ errorCode: "empty_deck" }),
    ).toBe("editorExport.exportFailed");
    expect(
      getEditorExportErrorTranslationKey(
        new Error("unsafe-slide-asset-origin"),
      ),
    ).toBe("editorExport.unsafeAssetOrigin");
  });

  it("uses a localized generic fallback for unknown errors", () => {
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "provider_failure",
        actionMessage: "Private provider response details",
      }),
    ).toBe("editorExport.exportFailed");
    expect(
      getEditorExportErrorTranslationKey(new Error("Network request failed")),
    ).toBe("editorExport.exportFailed");
    expect(
      getEditorExportErrorTranslationKey({
        errorCode: "comment_thread_resolved",
      }),
    ).toBe("editorExport.exportFailed");
  });
});
