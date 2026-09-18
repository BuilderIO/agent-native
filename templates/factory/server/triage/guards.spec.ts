import { describe, expect, it } from "vitest";

import {
  defaultTriagePolicyGuards,
  normalizeTriagePolicyGuards,
} from "./contracts.js";
import { evaluateStructuredGuards } from "./guards.js";

describe("triage policy guards", () => {
  it("does not treat an unknown Slack item as safe evidence", () => {
    const results = evaluateStructuredGuards(defaultTriagePolicyGuards(), {
      risk: "unknown",
    });

    expect(results).toEqual([
      {
        code: "unknown_change",
        passed: false,
        reason: "Insufficient structured evidence for an autonomous proposal.",
      },
    ]);
  });

  it("keeps hard never-automate categories when a rule tries to remove them", () => {
    const guards = normalizeTriagePolicyGuards({ neverAutomate: [] });

    expect(guards.neverAutomate).toEqual(
      expect.arrayContaining([
        "auth",
        "session",
        "identity",
        "credentials",
        "vault",
        "migration",
        "payments",
        "security",
        "publishable_package",
      ]),
    );
  });

  it("reports the typed guard for a sensitive path", () => {
    const results = evaluateStructuredGuards(defaultTriagePolicyGuards(), {
      repository: "BuilderIO/agent-native",
      changedFiles: ["packages/core/src/auth.ts"],
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "publishable_package",
          passed: false,
        }),
      ]),
    );
  });
});
