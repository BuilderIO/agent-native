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
  });
});
