// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shell/SettingsShell.js", () => ({
  SettingsShell: ({ appName }: { appName?: string }) => (
    <div data-testid="settings-shell">{appName}</div>
  ),
}));

import { SettingsTabsPage } from "./SettingsTabsPage.js";

describe("SettingsTabsPage shell selection", () => {
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
    vi.unstubAllGlobals();
  });

  async function render(
    props: { redesign?: boolean } = {},
    { withQueryClient = true }: { withQueryClient?: boolean } = {},
  ) {
    const page = (
      <SettingsTabsPage
        general={<div>General content</div>}
        appName="Clips"
        {...props}
      />
    );
    await act(async () => {
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

  it("renders the new shell", async () => {
    await render();
    expect(shell()?.textContent).toBe("Clips");
    expect(legacyTabs()).toBeNull();
  });

  it("renders today's tabs for surfaces that opt out", async () => {
    await render({ redesign: false });
    expect(legacyTabs()).not.toBeNull();
    expect(shell()).toBeNull();
  });

  it("renders today's tabs without a query client", async () => {
    await render({}, { withQueryClient: false });
    expect(legacyTabs()).not.toBeNull();
    expect(shell()).toBeNull();
  });
});
