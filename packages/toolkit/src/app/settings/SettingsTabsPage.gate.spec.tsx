// @vitest-environment happy-dom

import type { FeatureFlagState } from "@agent-native/core/client/feature-flags/use-feature-flag";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({
  state: { status: "loading", enabled: false } as FeatureFlagState,
  keys: [] as string[],
}));

vi.mock("@agent-native/core/client/feature-flags/use-feature-flag", () => ({
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

  async function render(
    props: { redesign?: boolean } = {},
    { withQueryClient = true }: { withQueryClient?: boolean } = {},
  ) {
    await act(async () => {
      const page = (
        <SettingsTabsPage
          general={<div>General content</div>}
          appName="Clips"
          {...props}
        />
      );
      root.render(
        withQueryClient ? (
          <QueryClientProvider client={new QueryClient()}>
            {page}
          </QueryClientProvider>
        ) : (
          page
        ),
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

  it("renders today's tabs without a query client", async () => {
    flag.state = { status: "loading", enabled: false };
    await render({}, { withQueryClient: false });
    expect(flag.keys).toEqual([]);
    expect(legacyTabs()).not.toBeNull();
    expect(shell()).toBeNull();
  });
});
