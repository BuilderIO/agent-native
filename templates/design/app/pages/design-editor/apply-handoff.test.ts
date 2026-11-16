import { describe, expect, it } from "vitest";

import { composeApplyHandoff } from "./apply-handoff";

describe("composeApplyHandoff", () => {
  it("orders remote, visuals, and tweak deltas after one leading full-app header", () => {
    const result = composeApplyHandoff({
      remote: { trusted: true, prompt: "Remote instructions", revision: 7 },
      localVisualEdits: [{ id: "visual-1", prompt: "Visual instructions" }],
      localTweakChanges: [
        { id: "spacing", label: "Spacing", oldValue: 2, newValue: 4 },
      ],
      fullApp: { enabled: true, designId: "design-1" },
    });
    expect(result.prompt.startsWith("This is a full-app design")).toBe(true);
    expect(result.prompt.indexOf("send-builder-message")).toBeLessThan(
      result.prompt.indexOf("Remote instructions"),
    );
    expect(result.prompt.indexOf("Remote instructions")).toBeLessThan(
      result.prompt.indexOf("Visual instructions"),
    );
    expect(result.prompt.indexOf("Visual instructions")).toBeLessThan(
      result.prompt.indexOf("Changed tweaks"),
    );
    expect(result.prompt.match(/send-builder-message/g)).toHaveLength(2);
    expect(result.includes).toEqual({
      remote: true,
      visualEditIds: ["visual-1"],
      tweakIds: ["spacing"],
    });
  });

  it("includes tweak-only deltas and keeps their acknowledgement explicit", () => {
    const result = composeApplyHandoff({
      localVisualEdits: [],
      localTweakChanges: [
        { id: "speed", label: "Speed", oldValue: 1, newValue: 3 },
      ],
      fullApp: { enabled: true, designId: "design-1" },
    });
    expect(result.prompt).toContain("Speed (id: `speed`): 1 → 3");
    expect(result.prompt).toContain("acknowledge-visual-edit-pending");
    expect(result.includes.tweakIds).toEqual(["speed"]);
    expect(result.includes.remote).toBe(false);
  });

  it("routes full-app tweaks through Builder without local source instructions", () => {
    const { prompt } = composeApplyHandoff({
      localVisualEdits: [],
      localTweakChanges: [
        { id: "gap", label: "Gap", oldValue: 1, newValue: 2 },
      ],
      fullApp: { enabled: true, designId: "d1" },
    });
    expect(prompt).toContain("send-builder-message");
    expect(prompt).not.toContain("Locate the source files");
    expect(prompt).not.toContain("verify the running page");
  });
});
