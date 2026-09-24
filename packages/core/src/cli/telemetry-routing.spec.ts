import { describe, expect, it } from "vitest";

import { shouldTrackCliRun } from "./telemetry-routing.js";

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
});
