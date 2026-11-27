import { describe, expect, it } from "vitest";

import { exportPreviewFailureKey } from "./EditPanel";

describe("exportPreviewFailureKey", () => {
  it("maps each capture failure to its own reason", () => {
    expect(exportPreviewFailureKey("no-preview")).toBe(
      "editPanel.exportPreview.noPreview",
    );
    expect(exportPreviewFailureKey("external-preview")).toBe(
      "editPanel.exportPreview.externalPreview",
    );
    expect(exportPreviewFailureKey("read-only-preview")).toBe(
      "editPanel.exportPreview.readOnlyPreview",
    );
    expect(exportPreviewFailureKey("selection-unresolved")).toBe(
      "editPanel.exportPreview.selectionUnresolved",
    );
    expect(exportPreviewFailureKey(null)).toBe(
      "editPanel.exportPreview.failed",
    );
  });
});
