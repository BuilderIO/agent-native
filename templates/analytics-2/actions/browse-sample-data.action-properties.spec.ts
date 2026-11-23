import { checkActionProperties } from "@agent-native/core/action-properties";
import { describe, it } from "vitest";

import browseSampleData from "./browse-sample-data.js";

describe("sample data action contract", () => {
  it("rejects malformed input and unauthenticated calls", async () => {
    await checkActionProperties(browseSampleData, {
      context: { caller: "tool" },
      runs: 20,
      seed: 117,
    });
  });
});
