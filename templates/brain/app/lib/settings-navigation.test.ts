import { describe, expect, it } from "vitest";

import {
  brainSettingsRedirect,
  brainSettingsSectionFromPath,
} from "./settings-navigation";

describe("Brain settings navigation", () => {
  it("maps the former section ids and the area ids to Brain › General tabs", () => {
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

  it("reads the Brain section from a Settings path", () => {
    expect(brainSettingsSectionFromPath("/settings/app/safety")).toBe("safety");
    expect(brainSettingsSectionFromPath("/settings/app")).toBe("general");
    expect(brainSettingsSectionFromPath("/settings/app/unknown")).toBe(
      undefined,
    );
    expect(brainSettingsSectionFromPath("/settings/model")).toBe(undefined);
  });
});
