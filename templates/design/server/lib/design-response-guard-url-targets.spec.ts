import { expect, it } from "vitest";

import { looksLikeDesignMutationRequest } from "./design-response-guard.js";

it("distinguishes read-only query URLs from explicit URL edits and frame imports", () => {
  for (const request of [
    "Summarize the page at example.invalid?mode=edit",
    "Summarize the page at example.invalid#edit",
    "Review the frame at example.invalid?mode=edit and suggest changes",
    "Explain the edit — https://example.invalid/preview",
    "Do not edit — https://example.invalid/preview",
  ]) {
    expect(looksLikeDesignMutationRequest(request)).toBe(false);
  }

  for (const request of [
    "Edit — https://example.invalid/preview",
    "Edit – https://example.invalid/preview",
    "Edit - https://example.invalid/preview",
    "Edit example.invalid?mode=view",
    "Edit example.invalid#preview",
    "import a frame from https://example.invalid/file",
    "import this frame from https://example.invalid/file",
  ]) {
    expect(looksLikeDesignMutationRequest(request)).toBe(true);
  }
});
