import { describe, expect, it } from "vitest";

import action from "./update-workspace-app-metadata.js";

describe("update-workspace-app-metadata action schema", () => {
  it("validates when-to-use examples when description is explicitly cleared", () => {
    expect(
      action.schema.safeParse({
        appId: "todo",
        description: null,
        whenToUse: ["Create a task from a meeting note"],
      }).success,
    ).toBe(true);
  });

  it("validates description when when-to-use examples are explicitly cleared", () => {
    expect(
      action.schema.safeParse({
        appId: "todo",
        description: "Track team tasks.",
        whenToUse: null,
      }).success,
    ).toBe(true);
  });
});
