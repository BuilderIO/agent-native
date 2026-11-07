import { expect, it } from "vitest";

import { looksLikeDesignMutationRequest } from "./design-response-guard.js";

it("does not interpret a read-only URL hostname as a design mutation", () => {
  expect(
    looksLikeDesignMutationRequest(
      "Summarize this design at https://update.example.invalid/preview,edit with its button visible.",
    ),
  ).toBe(false);
});
