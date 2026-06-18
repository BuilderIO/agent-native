import { describe, expect, it } from "vitest";
import { formatAgentsUsage, parseAgentsArgs } from "./agents.js";

describe("agents CLI", () => {
  it("defaults to list", () => {
    expect(parseAgentsArgs([])).toMatchObject({
      command: "list",
      json: false,
      errors: [],
    });
  });

  it("parses list options", () => {
    expect(
      parseAgentsArgs(["list", "--self-app-id", "dispatch", "--json"]),
    ).toMatchObject({
      command: "list",
      selfAppId: "dispatch",
      json: true,
      errors: [],
    });
  });

  it("reports unknown subcommands", () => {
    const parsed = parseAgentsArgs(["run"]);
    expect(parsed.errors).toContain("Unknown agents command: run");
    expect(formatAgentsUsage()).toContain("agent-native agents list");
  });
});
