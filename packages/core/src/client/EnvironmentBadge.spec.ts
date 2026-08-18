import { describe, expect, it } from "vitest";

import {
  buildEnvironmentUrl,
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

  it("requires an exact builder.io email domain", () => {
    expect(isBuilderIoEmployee("Steve@Builder.io")).toBe(true);
    expect(isBuilderIoEmployee("steve@builder.io.attacker.test")).toBe(false);
    expect(isBuilderIoEmployee(null)).toBe(false);
  });
});
