import { describe, expect, it } from "vitest";

import {
  experimentResultRows,
  qualifyFleetMutation,
} from "./ExperimentAdminPanels";

describe("qualifyFleetMutation", () => {
  it("preserves Core replace-rules metadata while qualifying the target app", () => {
    const rules = {
      version: 1 as const,
      mode: "rules" as const,
      emails: ["owner@example.test"],
      orgIds: ["org-1"],
      percentage: 25,
      rolloutEpoch: "stable-epoch",
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

describe("experimentResultRows", () => {
  it("keeps the backend's nested cohort metrics intact", () => {
    expect(
      experimentResultRows({
        control: { exposed: 100, conversions: 10, rate: 0.1 },
        treatment: { exposed: 120, conversions: 18, rate: 0.15 },
        lift: 0.5,
        sampleSize: 220,
      }),
    ).toEqual({
      control: { exposed: 100, conversions: 10, rate: 0.1 },
      treatment: { exposed: 120, conversions: 18, rate: 0.15 },
      lift: 0.5,
      sampleSize: 220,
    });
  });
});
