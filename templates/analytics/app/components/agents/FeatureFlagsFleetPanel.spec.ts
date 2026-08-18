import { describe, expect, it } from "vitest";

import {
  qualifyFleetMutation,
  reconcileVerifiedFleetMutation,
} from "./FeatureFlagsFleetPanel";

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

describe("reconcileVerifiedFleetMutation", () => {
  it("replaces optimistic state with the independently verified target state", () => {
    const directory = {
      directoryStatus: "available",
      apps: [
        {
          appId: "content",
          state: "ready",
          flags: [
            {
              key: "receiver",
              defaultValue: false,
              rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
            },
          ],
        },
      ],
    };
    expect(
      reconcileVerifiedFleetMutation(directory, "content", {
        contractVersion: 3,
        status: "verified",
        key: "receiver",
        rules: {
          version: 1,
          mode: "rules",
          emails: ["owner@example.test"],
          orgIds: [],
          percentage: 0,
          updatedAt: 1,
          updatedBy: "owner@example.test",
        },
        enabledForCurrentUser: true,
      }),
    ).toMatchObject({
      apps: [
        {
          flags: [
            {
              rules: { mode: "rules" },
              enabledForCurrentUser: true,
            },
          ],
        },
      ],
    });
  });
});
