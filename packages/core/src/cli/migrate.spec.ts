import { describe, expect, it } from "vitest";
import { parseMigrateArgs } from "./migrate.js";

describe("parseMigrateArgs", () => {
  it("parses source and output defaults", () => {
    expect(parseMigrateArgs(["./next-app"])).toEqual({
      source: "./next-app",
    });
  });

  it("parses named options", () => {
    expect(
      parseMigrateArgs([
        "./next-app",
        "--out",
        "../out",
        "--name=migration-lab",
        "--target",
        "agent-native",
        "--plan-only",
      ]),
    ).toEqual({
      source: "./next-app",
      output: "../out",
      appName: "migration-lab",
      target: "agent-native",
      planOnly: true,
    });
  });
});
