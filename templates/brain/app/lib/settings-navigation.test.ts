import { describe, expect, it } from "vitest";

import {
  brainSettingsRedirect,
  brainSettingsSectionFromPath,
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
    expect(resolveSettingsSection("labs", sections)).toBe("labs");
    expect(resolveSettingsSection("unknown", sections)).toBe("general");
    expect(resolveSettingsSection(null, sections)).toBe("general");
  });

  it("opens the tab that holds a redesigned area in today's Settings", () => {
    expect(resolveSettingsSection("behavior", sections)).toBe(
      "assistant-behavior",
    );
    expect(resolveSettingsSection("publishing", sections)).toBe(
      "publishing-review",
    );
    expect(resolveSettingsSection("safety", sections)).toBe("safety-evidence");
    expect(resolveSettingsSection("identity", sections)).toBe("general");
    expect(resolveSettingsSection("privacy", sections)).toBe("general");
  });

  it("maps today's section ids and the area ids to Brain › General tabs", () => {
    expect(brainSettingsRedirect("assistant-behavior")).toBe(
      "/settings/app/behavior",
    );
    expect(brainSettingsRedirect("publishing-review")).toBe(
      "/settings/app/publishing",
    );
    expect(brainSettingsRedirect("safety-evidence")).toBe(
      "/settings/app/safety",
    );
    expect(brainSettingsRedirect("privacy-sensitivity")).toBe(
      "/settings/app/privacy",
    );
    expect(brainSettingsRedirect("identity")).toBe("/settings/app/identity");
    expect(brainSettingsRedirect("privacy")).toBe("/settings/app/privacy");
    expect(brainSettingsRedirect("general")).toBe("/settings/app");
  });

  it("leaves core section ids to the Settings shell", () => {
    expect(brainSettingsRedirect("team")).toBeNull();
    expect(brainSettingsRedirect("labs")).toBeNull();
    expect(brainSettingsRedirect("agent")).toBeNull();
    expect(brainSettingsRedirect(null)).toBeNull();
  });

  it("reads the Brain section from a redesigned Settings path", () => {
    expect(brainSettingsSectionFromPath("/settings/app/safety")).toBe("safety");
    expect(brainSettingsSectionFromPath("/settings/app")).toBe("general");
    expect(brainSettingsSectionFromPath("/settings/app/unknown")).toBe(
      undefined,
    );
    expect(brainSettingsSectionFromPath("/settings/model")).toBe(undefined);
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
