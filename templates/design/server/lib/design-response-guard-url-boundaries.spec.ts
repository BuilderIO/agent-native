import { expect, it } from "vitest";

import { looksLikeDesignMutationRequest } from "./design-response-guard.js";

it("recognizes period-separated URL edits without treating time frames or URL text as edits", () => {
  for (const request of [
    "Edit. https://example.invalid/preview",
    "Please edit. example.invalid/preview",
    "import a frame from https://example.invalid/file",
  ]) {
    expect(looksLikeDesignMutationRequest(request), request).toBe(true);
  }

  for (const request of [
    "Build a time frame",
    "Explain the edit. https://example.invalid/preview",
    "Do not edit. https://example.invalid/preview",
    "Summarize edit-example.invalid/page",
    "Summarize edit-https://example.invalid/page",
  ]) {
    expect(looksLikeDesignMutationRequest(request), request).toBe(false);
  }
});
