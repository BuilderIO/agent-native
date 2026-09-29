// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launcherState = vi.hoisted(() => ({
  value: {
    apps: [
      { id: "plan", name: "Plan" },
      { id: "mail", name: "Mail" },
    ],
    isLoading: false,
    error: undefined,
    openApp: vi.fn(),
    retry: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "dispatch.pages.chatFirstWorkspaceApps"
      ? "Workspace apps"
      : key === "dispatch.pages.allApps"
        ? "All apps"
        : key,
}));

vi.mock("./layout/Layout", () => ({
  useDispatchWorkspaceAppLauncher: () => launcherState.value,
}));

import { DispatchChatHomeApps } from "./chat-home-apps";

describe("DispatchChatHomeApps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    launcherState.value.apps = [
      { id: "plan", name: "Plan" },
      { id: "mail", name: "Mail" },
    ];
    launcherState.value.openApp.mockReset();
    launcherState.value.retry.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows compact two-column app rows and a translated All apps link", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <DispatchChatHomeApps />
        </MemoryRouter>,
      );
    });

    const grid = container.querySelector("[aria-label='Workspace apps'] .grid");
    expect(grid?.className.split(" ")).toContain("grid-cols-2");

    const appButtons = [...(grid?.querySelectorAll("button") ?? [])];
    expect(appButtons.map((button) => button.textContent?.trim())).toEqual([
      "Plan",
      "Mail",
    ]);
    expect(appButtons).toHaveLength(2);
    for (const button of appButtons) {
      expect(button.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
    }
    expect(
      appButtons[0]
        ?.querySelector<HTMLElement>("[aria-hidden='true']")
        ?.style.getPropertyValue("--dispatch-app-icon-color-rgb"),
    ).toBe("47 111 237");
    expect(
      appButtons[1]
        ?.querySelector<HTMLElement>("[aria-hidden='true']")
        ?.style.getPropertyValue("--dispatch-app-icon-color-rgb"),
    ).toBe("59 130 246");

    const allAppsLink =
      container.querySelector<HTMLAnchorElement>("a[href='/apps']");
    expect(allAppsLink?.textContent?.trim()).toBe("All apps");
    expect(grid?.closest("section")?.lastElementChild).toBe(allAppsLink);
  });

  it("shows only the first six apps and keeps the All apps link", async () => {
    launcherState.value.apps = Array.from({ length: 8 }, (_, index) => ({
      id: `app-${index}`,
      name: `App ${index}`,
    }));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <DispatchChatHomeApps />
        </MemoryRouter>,
      );
    });

    const grid = container.querySelector("[aria-label='Workspace apps'] .grid");
    expect(
      [...(grid?.querySelectorAll("button") ?? [])].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["App 0", "App 1", "App 2", "App 3", "App 4", "App 5"]);

    const allAppsLink =
      container.querySelector<HTMLAnchorElement>("a[href='/apps']");
    expect(allAppsLink?.textContent?.trim()).toBe("All apps");
    expect(grid?.closest("section")?.lastElementChild).toBe(allAppsLink);
  });
});
