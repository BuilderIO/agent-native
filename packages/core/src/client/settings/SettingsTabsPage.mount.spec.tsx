// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsTabsPage } from "./SettingsTabsPage.js";

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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps an omitted workspace mount when a settings tab is selected", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "content", path: "/content" }]),
    );
    window.history.replaceState(null, "", "/dispatch/settings");

    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsTabsPage
            general={<div>General</div>}
            account={<div>Account</div>}
            team={<div>Team</div>}
          />
        </MemoryRouter>,
      );
    });

    const account = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((node) => node.textContent?.includes("Account"));
    if (!account) throw new Error("Account tab was not rendered");

    act(() => {
      account.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(window.location.pathname).toBe("/dispatch/settings/account");
  });
});
