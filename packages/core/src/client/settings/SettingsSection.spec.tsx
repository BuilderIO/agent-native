// @vitest-environment happy-dom

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { SettingsSection, SettingsSurfaceProvider } from "./SettingsSection.js";

describe("SettingsSection", () => {
  it("renders full-page sections as always-visible row groups", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SettingsSurfaceProvider surface="page">
          <SettingsSection
            icon={null}
            title="Integrations"
            subtitle="Connect your tools."
            open={false}
            onToggle={() => {}}
          >
            <div>Visible setting</div>
          </SettingsSection>
        </SettingsSurfaceProvider>,
      );
    });

    expect(container.textContent).toContain("Visible setting");
    expect(
      container.querySelector("[data-agent-native-settings-page]"),
    ).not.toBe(null);
    expect(container.querySelector("button")).toBe(null);

    act(() => root.unmount());
    container.remove();
  });
});
