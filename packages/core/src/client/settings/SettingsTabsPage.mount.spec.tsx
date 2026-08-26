// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTabsPage } from "./SettingsTabsPage.js";

/**
 * Regression for the settings side-nav dropping a workspace app mount:
 * `/dispatch/settings` -> click any nav item -> `/settings/general`.
 *
 * The nav writes the URL with `history.pushState`, so it cannot rely on the
 * React Router basename. It used to rebuild the mount from `appBasePath()`,
 * which fails closed to `""` whenever the workspace runtime flag or the app
 * manifest cannot confirm the mount — and `""` is indistinguishable from
 * "mounted at the origin root".
 */
describe("SettingsTabsPage app mount preservation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function renderSettings() {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsTabsPage
            general={<div>General content</div>}
            account={<div>Account content</div>}
            team={<div>Team content</div>}
            extraTabs={[
              { id: "agent", label: "Agent", content: <div>Agent</div> },
              {
                id: "integrations",
                label: "Integrations",
                content: <div>Integrations</div>,
              },
            ]}
          />
        </MemoryRouter>,
      );
    });
  }

  function navItems(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
  }

  function clickNavItem(label: string) {
    const item = navItems().find((node) => node.textContent?.includes(label));
    if (!item) throw new Error(`no settings nav item labelled "${label}"`);
    act(() => {
      item.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("keeps the mount for every nav item when the manifest omits the mount", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    window.history.replaceState(null, "", "/dispatch/settings");
    renderSettings();

    for (const [label, expected] of [
      ["Account", "/dispatch/settings/account"],
      ["Agent", "/dispatch/settings/agent"],
      ["Integrations", "/dispatch/settings/integrations"],
      ["Team", "/dispatch/settings/organization"],
      ["General", "/dispatch/settings/general"],
    ] as const) {
      clickNavItem(label);
      expect(window.location.pathname).toBe(expected);
    }
  });

  it("keeps the mount when nothing marks the runtime as a workspace", () => {
    window.history.replaceState(null, "", "/dispatch/settings");
    renderSettings();

    clickNavItem("Account");
    expect(window.location.pathname).toBe("/dispatch/settings/account");
  });

  it("keeps the mount when the configured base belongs to a sibling app", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/content");
    window.history.replaceState(null, "", "/dispatch/settings");
    renderSettings();

    clickNavItem("Agent");
    expect(window.location.pathname).toBe("/dispatch/settings/agent");
  });

  it("keeps the mount when navigating from an already-deep settings URL", () => {
    window.history.replaceState(null, "", "/dispatch/settings/account");
    renderSettings();

    clickNavItem("Agent");
    expect(window.location.pathname).toBe("/dispatch/settings/agent");
  });

  it("preserves the query string alongside the mount", () => {
    window.history.replaceState(null, "", "/dispatch/settings?scope=personal");
    renderSettings();

    clickNavItem("Account");
    expect(window.location.pathname).toBe("/dispatch/settings/account");
    expect(window.location.search).toBe("?scope=personal");
  });

  it("still writes root-relative URLs for an app mounted at the origin root", () => {
    window.history.replaceState(null, "", "/settings");
    renderSettings();

    clickNavItem("Account");
    expect(window.location.pathname).toBe("/settings/account");
  });

  it("selects the tab from a mounted settings URL the manifest does not list", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    window.history.replaceState(null, "", "/dispatch/settings/agent");
    renderSettings();

    const selected = navItems().find(
      (node) => node.getAttribute("aria-selected") === "true",
    );
    expect(selected?.textContent).toContain("Agent");
  });
});
