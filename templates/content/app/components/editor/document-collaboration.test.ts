import { describe, expect, it } from "vitest";

import { shouldUseLiveDocumentCollaboration } from "./document-collaboration";

describe("document collaboration host policy", () => {
  it("uses the live transport in the signed-in Content editor", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: false,
        openAiWidget: false,
      }),
    ).toBe(true);
  });

  it("uses the scoped body snapshot in an OpenAI widget", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: false,
        openAiWidget: true,
      }),
    ).toBe(false);
  });

  it("leaves local-file documents outside collaboration", () => {
    expect(
      shouldUseLiveDocumentCollaboration({
        isLocalFileDocument: true,
        openAiWidget: false,
      }),
    ).toBe(false);
  });
});
