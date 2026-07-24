import { describe, expect, it } from "vitest";

import { shouldTrackCliRun } from "./telemetry-routing.js";

describe("shouldTrackCliRun", () => {
  it.each([
    ["skills", ["add", "rewind", "--yes"]],
    ["skills", ["add", "--skill", "rewind", "--yes"]],
    ["skills", ["add", "--skill=rewind", "--yes"]],
  ])("defers telemetry for explicit Rewind installs", (command, args) => {
    expect(shouldTrackCliRun(command, args)).toBe(false);
  });

  it("tracks other CLI invocations immediately", () => {
    expect(shouldTrackCliRun("skills", ["add", "visual-plan"])).toBe(true);
    expect(shouldTrackCliRun("create", ["my-app"])).toBe(true);
  });
});
