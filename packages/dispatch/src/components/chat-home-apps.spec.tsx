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
    workspaceApps: [
      {
        id: "plan",
        name: "Plan",
        description: "Structured project plans",
        path: "/plan",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Email and inbox",
        path: "/mail",
      },
    ],
    isLoading: false,
    error: undefined,
    openApp: vi.fn(),
    retry: vi.fn(),
  },
}));
const appLayoutState = vi.hoisted(() => ({
  value: { pinnedIds: ["mail"], orderedIds: ["mail", "plan"] },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { name?: string }) =>
    ({
      "dispatch.nav.apps": "Apps",
      "dispatch.pages.allApps": "All apps",
      "dispatch.pages.chatFirstNewApp": "New",
      "dispatch.pages.openApp": "Open",
      "dispatch.pages.chatFirstOpenApp": "Open {{name}}",
      "dispatch.pages.chatFirstOpenInNewTab": "Open in new tab",
      "dispatch.pages.chatFirstDefaultDescriptionCalendar":
        "Localized Calendar description",
      "extensions.optionsFor": "Options for {{name}}",
      "dispatch.pages.searchApps": "Search apps",
      "dispatch.pages.searchAppsPlaceholder": "Search apps",
    })[key]?.replace("{{name}}", values?.name ?? "") ?? key,
}));

vi.mock("./layout/Layout", () => ({
  dispatchNavLinkTarget: (path: string) => path,
  useDispatchWorkspaceAppLauncher: () => launcherState.value,
}));

vi.mock("../lib/workspace-app-layout", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/workspace-app-layout")>();
  return {
    ...actual,
    useWorkspaceAppLayout: () => ({ layout: appLayoutState.value }),
  };
});

import { DispatchChatHomeApps } from "./chat-home-apps";

describe("DispatchChatHomeApps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    launcherState.value.workspaceApps = [
      {
        id: "plan",
        name: "Plan",
        description: "Structured project plans",
        path: "/plan",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Email and inbox",
        path: "/mail",
      },
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

  it("renders the searchable Electron-style app directory and open actions", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <DispatchChatHomeApps />
        </MemoryRouter>,
      );
    });

    const section = container.querySelector("section[aria-label='Apps']");
    const grid = section?.querySelector(".grid.grid-cols-1");
    expect(grid?.className.split(" ")).toContain("sm:grid-cols-2");
    expect(section?.querySelectorAll("article")).toHaveLength(2);
    expect(section?.querySelectorAll("article")[0]?.textContent).toContain(
      "Mail",
    );
    expect(container.textContent).toContain("Structured project plans");
    expect(
      container.querySelector("button[aria-label='Options for Mail']"),
    ).not.toBeNull();
    expect(
      container.querySelector("button[aria-label='Options for Plan']"),
    ).not.toBeNull();
    expect(container.querySelector("button[aria-label='Open Plan']")).not.toBe(
      null,
    );
    expect(
      container.querySelector<HTMLElement>(
        "article [aria-hidden='true'][style*='--dispatch-app-icon-color-rgb']",
      ),
    ).not.toBeNull();

    const allAppsLink =
      container.querySelector<HTMLAnchorElement>("a[href='/apps']");
    expect(allAppsLink?.textContent?.trim()).toContain("All apps");
  });

  it("filters app descriptions and opens the selected app", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <DispatchChatHomeApps />
        </MemoryRouter>,
      );
    });

    const search = container.querySelector<HTMLInputElement>(
      "input[placeholder='Search apps']",
    );
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "inbox");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.textContent).toContain("Mail");
    expect(container.textContent).not.toContain("Plan");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Open Mail']")
        ?.click();
    });
    expect(launcherState.value.openApp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mail" }),
    );
  });

  it("localizes the default description for a built-in app", async () => {
    launcherState.value.workspaceApps = [
      {
        id: "calendar",
        name: "Calendar",
        description: "Default English text",
        defaultDescriptionKey:
          "dispatch.pages.chatFirstDefaultDescriptionCalendar",
        path: "/calendar",
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chat"]}>
          <DispatchChatHomeApps />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Localized Calendar description");
    expect(container.textContent).not.toContain("Default English text");
  });
});
