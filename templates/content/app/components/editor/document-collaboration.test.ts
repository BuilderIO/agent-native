import { describe, expect, it } from "vitest";

import { shouldUseLiveDocumentCollaboration } from "./document-collaboration";

describe("document collaboration host policy", () => {
  it("uses the live transport in the signed-in Content editor", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: false,
        mcpDirectoryWidgetReadOnly: false,
      }),
    ).toBe(true);
  });

  it("uses the saved snapshot for a verified directory widget read", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: false,
        mcpDirectoryWidgetReadOnly: true,
      }),
    ).toBe(false);
  });

  it("leaves local-file documents outside collaboration", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: true,
        mcpDirectoryWidgetReadOnly: false,
      }),
    ).toBe(false);
  });
});
