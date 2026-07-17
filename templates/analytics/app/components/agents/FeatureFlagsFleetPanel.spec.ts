import { describe, expect, it } from "vitest";

import { qualifyFleetMutation } from "./FeatureFlagsFleetPanel";

describe("qualifyFleetMutation", () => {
  it("preserves Core rollout rules while qualifying the target app", () => {
    const rules = {
      version: 1 as const,
      mode: "rules" as const,
      emails: ["owner@example.test"],
      orgIds: ["org-1"],
      percentage: 25,
    };

    expect(
      qualifyFleetMutation("app-1", {
        key: "new-editor",
        operation: "replace-rules",
        rules,
      }),
    ).toEqual({
      appId: "app-1",
      key: "new-editor",
      operation: "replace-rules",
      rules,
    });
  });
});
