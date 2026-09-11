import { describe, expect, it } from "vitest";

import {
  createSettingsSectionIds,
  resolveSettingsSection,
  withSettingsSection,
} from "./settings-navigation";

describe("Brain settings navigation", () => {
  const sections = createSettingsSectionIds([
    "assistant-behavior",
    "publishing-review",
    "safety-evidence",
    "agent",
    "connections",
    "workspace",
  ]);

  it("accepts a valid settings deep link and falls back safely", () => {
    expect(resolveSettingsSection("safety-evidence", sections)).toBe(
      "safety-evidence",
    );
    expect(resolveSettingsSection("team", sections)).toBe("team");
    expect(resolveSettingsSection("unknown", sections)).toBe("general");
    expect(resolveSettingsSection(null, sections)).toBe("general");
  });

  it("preserves other query parameters while changing settings sections", () => {
    expect(
      withSettingsSection(
        new URLSearchParams("from=agent&section=connections"),
        "publishing-review",
      ).toString(),
    ).toBe("from=agent&section=publishing-review");

    expect(
      withSettingsSection(
        new URLSearchParams("from=agent&section=connections"),
        "general",
      ).toString(),
    ).toBe("from=agent");
  });
});
