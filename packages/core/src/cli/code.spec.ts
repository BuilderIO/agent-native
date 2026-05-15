import { describe, expect, it } from "vitest";
import { CODE_AGENT_CLI_GOALS, codeUsage, resolveCodeCommand } from "./code.js";

describe("resolveCodeCommand", () => {
  it("shows help when no goal is provided", () => {
    expect(resolveCodeCommand([])).toEqual({ kind: "help" });
    expect(resolveCodeCommand(["--help"])).toEqual({ kind: "help" });
  });

  it("lists available goals", () => {
    expect(resolveCodeCommand(["goals"])).toEqual({ kind: "list-goals" });
    expect(resolveCodeCommand(["list"])).toEqual({ kind: "list-goals" });
  });

  it("forwards slash goals to their backing command", () => {
    expect(
      resolveCodeCommand(["/migrate", "./source", "--out", "../migrated"]),
    ).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["./source", "--out", "../migrated"],
    });
  });

  it("forwards non-migration slash goals", () => {
    expect(resolveCodeCommand(["/audit", "--url", "https://example.com"])).toEqual(
      {
        kind: "run-goal",
        goalId: "audit",
        forwardedArgs: ["--url", "https://example.com"],
      },
    );
  });

  it("accepts bare goal aliases", () => {
    expect(resolveCodeCommand(["migration", "--describe", "old app"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["--describe", "old app"],
    });
  });

  it("keeps resume/status/ui/stop as default-goal conveniences", () => {
    expect(resolveCodeCommand(["resume", "--last"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["resume", "--last"],
    });
  });

  it("treats freeform input as the default goal source", () => {
    expect(resolveCodeCommand(["./legacy-app", "--emit"])).toEqual({
      kind: "run-goal",
      goalId: "migrate",
      forwardedArgs: ["./legacy-app", "--emit"],
    });
  });
});

describe("codeUsage", () => {
  it("documents migrate as a slash goal", () => {
    expect(codeUsage()).toContain("agent-native code /audit --url");
    expect(codeUsage()).toContain("agent-native code /migrate <source>");
    expect(codeUsage()).toContain("/migrate");
  });
});

describe("CODE_AGENT_CLI_GOALS", () => {
  it("keeps slash goals mapped through an explicit backing command", () => {
    expect(CODE_AGENT_CLI_GOALS).toContainEqual(
      expect.objectContaining({
        id: "migrate",
        slashCommand: "/migrate",
        backingCommand: "migrate",
      }),
    );
    expect(CODE_AGENT_CLI_GOALS).toContainEqual(
      expect.objectContaining({
        id: "audit",
        slashCommand: "/audit",
        backingCommand: "audit-agent-web",
      }),
    );
  });
});
