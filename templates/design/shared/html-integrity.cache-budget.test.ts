import { expect, it } from "vitest";

import {
  _validatedContentCountForTests,
  assertDesignHtmlEditIntegrity,
} from "./html-integrity";

it("keeps validated documents within a character budget, not just a count", () => {
  const paragraph = "<p>lorem ipsum dolor sit amet</p>".repeat(125_000);
  let previousContent = "";
  for (let edit = 0; edit < 8; edit += 1) {
    const nextContent = `<!doctype html><html><body><h1>${edit}</h1>${paragraph}</body></html>`;
    assertDesignHtmlEditIntegrity({
      previousContent,
      nextContent,
      fileType: "html",
    });
    previousContent = nextContent;
  }

  // Each document is ~4M characters; the budget holds 24M.
  expect(_validatedContentCountForTests()).toBeLessThanOrEqual(6);
});
