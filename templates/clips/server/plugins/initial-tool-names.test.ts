import { describe, expect, it } from "vitest";

import { INITIAL_TOOL_NAMES } from "./initial-tool-names.js";

describe("Clips initial chat tools", () => {
  it("exposes recording trim and split actions to the agent", () => {
    expect(INITIAL_TOOL_NAMES).toContain("trim-recording");
    expect(INITIAL_TOOL_NAMES).toContain("split-recording");
  });
});
