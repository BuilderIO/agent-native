// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTabsPage } from "./SettingsTabsPage.js";

function stubMobileViewport(isMobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 767px)" ? isMobile : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function runAnimationFramesImmediately() {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function captureAnimationFrame() {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return () => frame?.(0);
}

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

  it("focuses the settings search on desktop entry", () => {
    stubMobileViewport(false);
    runAnimationFramesImmediately();

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
        />,
      );
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(document.activeElement).toBe(searchInput);
  });

  it("does not focus the settings search on mobile entry", () => {
    stubMobileViewport(true);
    runAnimationFramesImmediately();

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
        />,
      );
    });

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not steal focus from settings controls during entry", () => {
    stubMobileViewport(false);
    const runFrame = captureAnimationFrame();

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          team={<div>Team members</div>}
        />,
      );
    });

    const teamTab =
      container.querySelector<HTMLButtonElement>("#settings-tab-team");
    expect(teamTab).not.toBeNull();

    act(() => {
      teamTab!.focus();
      runFrame();
    });

    expect(document.activeElement).toBe(teamTab);
  });

  it("opens general settings by default when the route has no hash", () => {
    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          extraTabs={[
            {
              id: "integrations",
              label: "Integrations",
              content: <div>Integration content</div>,
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("General content");
    expect(container.textContent).not.toContain("Integration content");
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

  it("updates the semantic route when switching tabs", () => {
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

    expect(window.location.pathname).toBe("/settings/whats-new");
    expect(window.location.hash).toBe("");
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

  it("visually separates app, agent, and workspace tabs", () => {
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
              group: "agent",
              content: <div>Agent settings</div>,
            },
            {
              id: "integrations",
              label: "Integrations",
              group: "agent",
              content: <div>Connection settings</div>,
            },
          ]}
        />,
      );
    });

    expect(
      container.querySelector('[data-settings-tab-group="app"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-settings-tab-group="agent"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-settings-tab-group="workspace"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-settings-tab-group="updates"]'),
    ).toBeNull();
  });

  it("keeps linked settings navigation last with an external-link marker", () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsTabsPage
            general={<div>General content</div>}
            team={<div>Team members</div>}
            whatsNew={<div>Recent updates</div>}
            extraTabs={[
              {
                id: "integrations",
                label: "Integrations",
                group: "workspace",
                content: <div>Connection settings</div>,
              },
              {
                id: "workspace",
                label: "Workspace",
                group: "workspace",
                href: "/settings#workspace",
                content: <div>Workspace settings</div>,
              },
            ]}
          />
        </MemoryRouter>,
      );
    });

    expect(
      Array.from(container.querySelectorAll('[role="tab"]'), (tab) =>
        tab.textContent?.trim(),
      ),
    ).toEqual(["General", "Integrations", "Team", "What's new", "Workspace"]);

    const workspaceLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/settings#workspace"]',
    );
    expect(workspaceLink).not.toBeNull();
    expect(workspaceLink?.querySelector("svg")).not.toBeNull();
    expect(
      workspaceLink?.closest('[data-settings-tab-group="workspace"]'),
    ).not.toBeNull();
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

  it("reports organization hashes to a controlled Team tab without rewriting the URL", () => {
    window.history.replaceState(null, "", "/settings#organization");

    function ControlledSettings() {
      const [value, setValue] = React.useState("general");
      return (
        <SettingsTabsPage
          value={value}
          onValueChange={setValue}
          general={<div>General content</div>}
          team={<div>Team members</div>}
        />
      );
    }

    act(() => {
      root.render(<ControlledSettings />);
    });

    expect(container.textContent).toContain("Team members");
    expect(container.textContent).not.toContain("General content");
    expect(window.location.hash).toBe("#organization");

    const generalTab = container.querySelector<HTMLButtonElement>(
      "#settings-tab-general",
    );
    act(() => {
      generalTab!.click();
    });

    expect(container.textContent).toContain("General content");
    expect(container.textContent).not.toContain("Team members");
    expect(window.location.hash).toBe("#organization");
  });

  it("leaves controlled section hashes for the active panel", () => {
    window.history.replaceState(null, "", "/settings#language");
    const onValueChange = vi.fn();

    act(() => {
      root.render(
        <SettingsTabsPage
          value="general"
          onValueChange={onValueChange}
          general={<div>General content</div>}
          team={<div>Team members</div>}
        />,
      );
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("General content");
  });

  it("selects the owning tab for a section deep link", () => {
    window.history.replaceState(null, "", "/settings#voice");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          extraTabs={[
            {
              id: "agent",
              label: "Agent",
              content: <div>Agent voice settings</div>,
              searchEntries: [
                {
                  id: "section:voice",
                  label: "Voice Transcription",
                  hash: "voice",
                },
              ],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Agent voice settings");
    expect(container.textContent).not.toContain("General content");
  });

  it("selects the deepest matching tab for nested agent deep links", () => {
    window.history.replaceState(null, "", "/settings#agent:resources:files");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          extraTabs={[
            {
              id: "agent",
              label: "Overview",
              group: "agent",
              content: <div>Agent overview</div>,
            },
            {
              id: "agent:resources",
              label: "Resources",
              group: "agent",
              content: <div>Agent files</div>,
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Agent files");
    expect(container.textContent).not.toContain("Agent overview");
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

  it("renders the Extensions tab from Settings", () => {
    window.history.replaceState(null, "", "/settings#extensions");

    act(() => {
      root.render(
        <SettingsTabsPage
          general={<div>General content</div>}
          extraTabs={[
            {
              id: "extensions",
              label: "Extensions",
              group: "workspace",
              content: <div>Extension management</div>,
            },
          ]}
        />,
      );
    });

    expect(container.querySelector("#settings-tab-extensions")).not.toBeNull();
    expect(container.textContent).toContain("Extension management");
    expect(container.textContent).not.toContain("General content");
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
