// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SettingsTabsPage } from "./SettingsTabsPage.js";

describe("SettingsTabsPage group labels", () => {
  it("labels today's nav groups in Title Case, including Mail's automation group", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const tab = (id: string, group: string) => ({
      id,
      label: id,
      group,
      content: React.createElement("div", null, id),
    });

    act(() => {
      root.render(
        React.createElement(SettingsTabsPage, {
          general: React.createElement("div", null, "General"),
          labs: [],
          extraTabs: [
            tab("rules", "automation"),
            tab("integrations", "integrations"),
            tab("organization", "workspace"),
            tab("agent", "agent"),
          ],
        }),
      );
    });

    const labels = [
      ...container.querySelectorAll<HTMLElement>("[data-settings-tab-group]"),
    ].map((group) => group.firstElementChild?.firstElementChild?.textContent);
    expect(labels).toEqual([
      "Personal",
      "Automation",
      "Integrations",
      "Workspace",
      "Agent",
    ]);
    for (const label of labels) {
      expect(label?.[0]).toBe(label?.[0]?.toUpperCase());
    }

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
