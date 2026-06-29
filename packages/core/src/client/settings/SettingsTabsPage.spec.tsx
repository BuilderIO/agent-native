// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTabsPage } from "./SettingsTabsPage.js";

describe("SettingsTabsPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", "/settings");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens the team tab from the hash and avoids rendering a settings title", () => {
    window.history.replaceState(null, "", "/settings#team");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
          whatsNew={<div>Recent updates</div>}
        />,
      );
    });

    expect(container.textContent).toContain("Team members");
    expect(container.textContent).not.toContain("General content");
    expect(container.textContent).not.toContain("Settings");
  });

  it("updates the hash when switching tabs", () => {
    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
          whatsNew={<div>Recent updates</div>}
        />,
      );
    });

    const whatsNewTab = container.querySelector<HTMLButtonElement>(
      "#settings-tab-whats-new",
    );
    expect(whatsNewTab).not.toBeNull();

    act(() => {
      whatsNewTab!.click();
    });

    expect(window.location.hash).toBe("#whats-new");
    expect(container.textContent).toContain("Recent updates");
    expect(container.textContent).not.toContain("General content");
  });
});
