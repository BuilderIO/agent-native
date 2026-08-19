import { describe, expect, it } from "vitest";

import {
  BETA_OPT_OUT_DURATION_MS,
  buildEnvironmentOptOutUrl,
  buildEnvironmentUrl,
  isBetaOptOutActive,
  isBuilderIoEmployee,
  resolveEnvironmentChannel,
  resolveEnvironmentTargets,
} from "./EnvironmentBadge.js";

describe("EnvironmentBadge", () => {
  it("recognizes first-party beta and production hosts", () => {
    expect(resolveEnvironmentTargets("beta.plan.agent-native.com")).toEqual({
      betaHost: "beta.plan.agent-native.com",
      productionHost: "plan.agent-native.com",
    });
    expect(resolveEnvironmentTargets("agent-workspace.builder.io")).toEqual({
      betaHost: "beta.agent-workspace.builder.io",
      productionHost: "agent-workspace.builder.io",
    });
    expect(resolveEnvironmentTargets("chat.agent-native.com")).toEqual({
      betaHost: "beta.chat.agent-native.com",
      productionHost: "chat.agent-native.com",
    });
    expect(resolveEnvironmentTargets("starter.agent-native.com")).toBeNull();
    expect(resolveEnvironmentTargets("www.agent-native.com")).toBeNull();
    expect(resolveEnvironmentTargets("example.com")).toBeNull();
  });

  it("prefers explicit deployment config over hostname inference", () => {
    expect(
      resolveEnvironmentChannel(
        { deployment: { environment: "production" } },
        "beta.plan.agent-native.com",
      ),
    ).toBe("production");
    expect(resolveEnvironmentChannel({}, "beta.plan.agent-native.com")).toBe(
      "beta",
    );
  });

  it("preserves the path, query, and hash while switching hosts", () => {
    expect(
      buildEnvironmentUrl(
        "https://beta.plan.agent-native.com/projects/42?tab=activity#runs",
        "plan.agent-native.com",
      ),
    ).toBe("https://plan.agent-native.com/projects/42?tab=activity#runs");
  });

  it("adds a 24-hour opt-out when switching back to production", () => {
    const now = 1_700_000_000_000;
    expect(
      buildEnvironmentOptOutUrl(
        "https://beta.plan.agent-native.com/projects/42?tab=activity#runs",
        "plan.agent-native.com",
        now,
      ),
    ).toBe(
      `https://plan.agent-native.com/projects/42?tab=activity&agentNativeBetaOptOut=${now + BETA_OPT_OUT_DURATION_MS}#runs`,
    );
  });

  it("only treats a future opt-out expiry as active", () => {
    expect(isBetaOptOutActive("1700000001000", 1_700_000_000_000)).toBe(true);
    expect(isBetaOptOutActive("1700000000000", 1_700_000_000_000)).toBe(false);
    expect(isBetaOptOutActive("not-a-timestamp", 1_700_000_000_000)).toBe(
      false,
    );
  });

  it("requires an exact builder.io email domain", () => {
    expect(isBuilderIoEmployee("Steve@Builder.io")).toBe(true);
    expect(isBuilderIoEmployee("steve@builder.io.attacker.test")).toBe(false);
    expect(isBuilderIoEmployee(null)).toBe(false);
  });
});
