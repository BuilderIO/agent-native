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

  it("places extra settings tabs between general and team", () => {
    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
          whatsNew={<div>Recent updates</div>}
          extraTabs={[
            {
              id: "agent",
              label: "Agent",
              content: <div>Agent settings</div>,
            },
          ]}
        />,
      );
    });

    const tabLabels = Array.from(
      container.querySelectorAll('[role="tab"]'),
      (tab) => tab.textContent,
    );
    expect(tabLabels).toEqual(["General", "Agent", "Team", "What's new"]);
  });

  it("honors the controlled value and reports changes without touching the hash", () => {
    const onValueChange = vi.fn();

    act(() => {
      root.render(
        <SettingsTabsPage
          value="team"
          onValueChange={onValueChange}
          general={<div>General content</div>}
          team={<div>Team members</div>}
          whatsNew={<div>Recent updates</div>}
        />,
      );
    });

    // The controlled value wins over the (empty) hash.
    expect(container.textContent).toContain("Team members");
    expect(container.textContent).not.toContain("General content");

    const whatsNewTab = container.querySelector<HTMLButtonElement>(
      "#settings-tab-whats-new",
    );
    act(() => {
      whatsNewTab!.click();
    });

    // Parent owns the state: it is notified, but the component neither switches
    // on its own nor writes the hash.
    expect(onValueChange).toHaveBeenCalledWith("whats-new");
    expect(window.location.hash).toBe("");
    expect(container.textContent).toContain("Team members");
  });

  it("opens an extra workspace tab from the workspace hash", () => {
    window.history.replaceState(null, "", "/settings#workspace");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
          extraTabs={[
            {
              id: "workspace",
              label: "Workspace",
              content: <div>Workspace controls</div>,
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Workspace controls");
    expect(container.textContent).not.toContain("Team members");
  });

  it("opens an organization tab from organization and legacy team hashes", () => {
    window.history.replaceState(null, "", "/settings#organization");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          extraTabs={[
            {
              id: "organization",
              label: "Organization",
              content: <div>Organization members</div>,
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Organization members");
    expect(container.textContent).not.toContain("General content");

    act(() => {
      window.history.replaceState(null, "", "/settings#team");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(container.textContent).toContain("Organization members");
    expect(container.textContent).not.toContain("General content");
  });
});
