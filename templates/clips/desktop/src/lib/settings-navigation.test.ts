import { describe, expect, it } from "vitest";

import { initialDesktopSettingsTab } from "./settings-navigation";

describe("desktop settings navigation", () => {
  it("preserves an explicitly requested tab", () => {
    expect(initialDesktopSettingsTab("dictation")).toBe("dictation");
  });

  it("defaults generic settings opens to General", () => {
    expect(initialDesktopSettingsTab()).toBe("general");
  });
});
