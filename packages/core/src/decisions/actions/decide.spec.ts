import { describe, expect, it } from "vitest";

import decideAction from "./decide.js";

describe("decide action", () => {
  it("describes score support through the Builder Jev proxy", () => {
    expect(decideAction.tool.description).toContain(
      "Builder Jev proxy is verified for predicate, choice, and score questions",
    );
  });
});
