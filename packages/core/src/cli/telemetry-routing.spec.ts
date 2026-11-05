import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  shouldTrackCliRun,
  telemetryCommandName,
} from "./telemetry-routing.js";

describe("telemetryCommandName", () => {
  it("sends known commands by name", () => {
    expect(telemetryCommandName("dev")).toBe("dev");
    expect(telemetryCommandName("--version")).toBe("--version");
  });

  it("reports no command as none", () => {
    expect(telemetryCommandName(undefined)).toBe("none");
  });

  it.each([
    "fix the acme billing bug",
    "/home/ada/acme",
    "my-private-script",
    "devv",
  ])("never sends %s verbatim", (command) => {
    expect(telemetryCommandName(command)).toBe("unknown");
  });

  it("knows every command in the CLI's switch", () => {
    // source-read-ok: the switch is the only other list of commands, and a
    // command missing from the telemetry list silently reports as "unknown".
    const source = fs.readFileSync(
      new URL("./index.ts", import.meta.url),
      "utf8",
    );
    const commands = [...source.matchAll(/^ {2}case "([^"]+)":/gm)].map(
      (match) => match[1],
    );

    expect(commands.length).toBeGreaterThan(30);
    expect(
      commands.filter((command) => telemetryCommandName(command) === "unknown"),
    ).toEqual([]);
  });
});

describe("shouldTrackCliRun", () => {
  it.each([
    ["skills", ["add", "rewind", "--yes"]],
    ["skills", ["add", "--skill", "rewind", "--yes"]],
    ["skills", ["add", "--skill=rewind", "--yes"]],
    ["skills", ["add", "screen-memory", "--yes"]],
    ["skills", ["add", "--skill", "clips-rewind", "--yes"]],
    ["skills", ["add", "--skill=agent-native-rewind", "--yes"]],
    ["skills", ["rewind", "--yes"]],
    ["skills", ["screen-memory", "--yes"]],
    ["skills", ["clips-rewind", "--yes"]],
    ["skills", ["agent-native-rewind", "--yes"]],
    ["skills", ["--skill", "rewind", "--yes"]],
    ["skills", ["--skill=screen-memory", "--yes"]],
    ["skills", ["-s", "clips-rewind", "--yes"]],
  ])("defers telemetry for explicit Rewind installs", (command, args) => {
    expect(shouldTrackCliRun(command, args)).toBe(false);
  });

  it.each([
    ["skills", []],
    ["skills", ["add"]],
    ["skills", ["add", "--no-mcp"]],
    ["skills", ["--no-mcp"]],
  ])(
    "defers telemetry until an interactive skill is selected",
    (command, args) => {
      expect(shouldTrackCliRun(command, args)).toBe(false);
    },
  );

  it("tracks other CLI invocations immediately", () => {
    expect(shouldTrackCliRun("skills", ["add", "visual-plan"])).toBe(true);
    expect(
      shouldTrackCliRun("skills", ["add", "--client", "codex", "assets"]),
    ).toBe(true);
    expect(shouldTrackCliRun("skills", ["add", "--yes", "assets"])).toBe(true);
    expect(shouldTrackCliRun("skills", ["--client", "codex", "assets"])).toBe(
      true,
    );
    expect(shouldTrackCliRun("skills", ["--skill", "assets"])).toBe(true);
    expect(shouldTrackCliRun("skills", ["-s", "assets"])).toBe(true);
    expect(shouldTrackCliRun("skills", ["list"])).toBe(true);
    expect(shouldTrackCliRun("create", ["my-app"])).toBe(true);
  });

  it("never tracks the telemetry command itself", () => {
    expect(shouldTrackCliRun("telemetry", ["disable"])).toBe(false);
    expect(shouldTrackCliRun("telemetry", ["status"])).toBe(false);
  });
});
