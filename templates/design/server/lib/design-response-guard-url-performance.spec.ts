import { expect, it } from "vitest";

import { looksLikeDesignMutationRequest } from "./design-response-guard.js";

it("handles long punctuation within a URL", () => {
  expect(
    looksLikeDesignMutationRequest(
      `example.invalid/path${",".repeat(200_000)}x`,
    ),
  ).toBe(false);
});
