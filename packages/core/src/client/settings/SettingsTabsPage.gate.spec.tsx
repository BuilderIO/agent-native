// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeatureFlagState } from "../feature-flags/use-feature-flag.js";

const flag = vi.hoisted(() => ({
  state: { status: "loading", enabled: false } as FeatureFlagState,
  keys: [] as string[],
}));

vi.mock("../feature-flags/use-feature-flag.js", () => ({
  useFeatureFlagState: (key: string) => {
    flag.keys.push(key);
    return flag.state;
  },
}));
vi.mock("./shell/SettingsShell.js", () => ({
  SettingsShell: ({ appName }: { appName?: string }) => (
    <div data-testid="settings-shell">{appName}</div>
  ),
}));

import { SettingsTabsPage } from "./SettingsTabsPage.js";

describe("SettingsTabsPage settings-redesign gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", "/settings");
    flag.keys = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(props: { redesign?: boolean } = {}) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <SettingsTabsPage
            general={<div>General content</div>}
            appName="Clips"
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const legacyTabs = () => container.querySelector('[role="tablist"]');
  const shell = () => container.querySelector('[data-testid="settings-shell"]');

  it("holds a skeleton, not today's tabs, until the flag answers", async () => {
    flag.state = { status: "loading", enabled: false };
    await render();
    expect(flag.keys).toContain("settings-redesign");
    expect(
      container.querySelector('[role="status"][aria-busy="true"]'),
    ).not.toBeNull();
    expect(legacyTabs()).toBeNull();
    expect(shell()).toBeNull();
  });

  it("renders today's tabs when the flag is off", async () => {
    flag.state = { status: "ready", enabled: false };
    await render();
    expect(legacyTabs()).not.toBeNull();
    expect(shell()).toBeNull();
  });

  it("fails closed to today's tabs when flags are unreadable", async () => {
    flag.state = { status: "unavailable", enabled: false };
    await render();
    expect(legacyTabs()).not.toBeNull();
  });

  it("renders the new shell when the flag is on", async () => {
    flag.state = { status: "ready", enabled: true };
    await render();
    expect(shell()?.textContent).toBe("Clips");
    expect(legacyTabs()).toBeNull();
  });

  it("never waits on the flag for surfaces that opt out", async () => {
    flag.state = { status: "loading", enabled: false };
    await render({ redesign: false });
    expect(flag.keys).toEqual([]);
    expect(legacyTabs()).not.toBeNull();
  });
});
