// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_FIRST_APP_RAIL_SHOW_ALL_STORAGE_KEY,
  ChatFirstAppsRail,
} from "./apps-rail.js";

describe("ChatFirstAppsRail", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localStorageDescriptor: PropertyDescriptor | undefined;

  function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        return values.get(key) ?? null;
      },
      key(index) {
        return [...values.keys()][index] ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(String(key), String(value));
      },
    };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    window.localStorage.removeItem(CHAT_FIRST_APP_RAIL_SHOW_ALL_STORAGE_KEY);
    container.remove();
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("grays non-selected app icons while keeping the selected icon in color", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeAppId="content"
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    const selectedIcon = container.querySelector<HTMLElement>(
      '[data-app-id="content"] [data-chat-first-app-icon]',
    );
    const inactiveIcon = container.querySelector<HTMLElement>(
      '[data-app-id="analytics"] [data-chat-first-app-icon]',
    );

    expect(selectedIcon?.className).not.toContain("grayscale");
    expect(
      selectedIcon?.closest("[data-chat-first-app]")?.className.split(" "),
    ).toContain("bg-sidebar-accent");
    expect(
      inactiveIcon?.closest("[data-chat-first-app]")?.className.split(" "),
    ).not.toContain("bg-sidebar-accent");
    expect(
      selectedIcon
        ?.querySelector("[data-icon-inactive]")
        ?.getAttribute("data-icon-inactive"),
    ).toBe("false");
    expect(inactiveIcon?.className).toContain("grayscale");
    expect(
      inactiveIcon
        ?.querySelector("[data-icon-inactive]")
        ?.getAttribute("data-icon-inactive"),
    ).toBe("true");
  });

  it("keeps app icons in color when no app is selected", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "content", name: "Content" }]}
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    const icon = container.querySelector<HTMLElement>(
      "[data-chat-first-app-icon]",
    );
    expect(icon?.className).not.toContain("grayscale");
    expect(
      icon
        ?.querySelector("[data-icon-inactive]")
        ?.getAttribute("data-icon-inactive"),
    ).toBe("false");
  });

  it("shows a collapsed app name immediately on hover", async () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "calendar", name: "Calendar" }]}
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    const appButton = container.querySelector<HTMLButtonElement>(
      '[data-app-id="calendar"]',
    );
    expect(appButton).not.toBeNull();

    await act(async () => {
      appButton?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(
      document.querySelector('[data-agent-native-tooltip="true"]')?.textContent,
    ).toContain("Calendar");
  });

  it("shows the all-apps label immediately on hover", async () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[]}
          collapsed
          onOpenAllApps={vi.fn()}
          onOpenApp={vi.fn()}
          renderIcon={() => null}
        />,
      );
    });

    const allApps = container.querySelector<HTMLButtonElement>(
      "[data-chat-first-all-apps]",
    );
    expect(allApps).not.toBeNull();

    await act(async () => {
      allApps?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(
      document.querySelector('[data-agent-native-tooltip="true"]')?.textContent,
    ).toContain("All apps");
  });

  it("hides the create-app trigger when the rail is collapsed", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "content", name: "Content" }]}
          collapsed
          onCreateApp={vi.fn()}
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    expect(
      container.querySelector('button[aria-label="Create app"]'),
    ).toBeNull();

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "content", name: "Content" }]}
          onCreateApp={vi.fn()}
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    expect(
      container.querySelector('button[aria-label="Create app"]'),
    ).not.toBeNull();
  });

  it("adds an accent background to the active app row in the expanded rail", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeAppId="content"
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options?.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    const activeRow = container.querySelector<HTMLElement>(
      '[data-chat-first-app][data-app-id="content"]',
    );
    const inactiveRow = container.querySelector<HTMLElement>(
      '[data-chat-first-app][data-app-id="analytics"]',
    );
    expect(activeRow?.className.split(" ")).toContain("bg-sidebar-accent");
    expect(inactiveRow?.className.split(" ")).not.toContain(
      "bg-sidebar-accent",
    );
  });

  it("keeps a selected app outside the default slice visible", () => {
    const apps = Array.from({ length: 6 }, (_, index) => ({
      id: `app-${index}`,
      name: `App ${index}`,
    }));

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={apps}
          activeAppId="app-5"
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    const visibleAppIds = Array.from(
      container.querySelectorAll<HTMLElement>("[data-chat-first-app]"),
      (app) => app.dataset.appId,
    );
    expect(visibleAppIds).toHaveLength(6);
    expect(visibleAppIds.at(-1)).toBe("app-5");
    expect(container.querySelector('[data-app-id="app-5"]')).not.toBeNull();
  });

  it("uses a host-provided default order and visible-app count", () => {
    const defaultAppIds = [
      "mail",
      "calendar",
      "design",
      "clips",
      "content",
      "analytics",
    ];
    const apps = [
      ...defaultAppIds.map((id) => ({ id, name: id })),
      { id: "brain", name: "Brain" },
    ];

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={apps}
          defaultAppIds={defaultAppIds}
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-chat-first-app]"),
        (app) => app.dataset.appId,
      ),
    ).toEqual(defaultAppIds);
  });

  it("persists the expanded rail state across remounts", () => {
    const apps = Array.from({ length: 7 }, (_, index) => ({
      id: `app-${index}`,
      name: `App ${index}`,
    }));

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={apps}
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(5);
    const showMore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Show more",
    );
    expect(showMore).toBeDefined();

    act(() => {
      showMore?.click();
    });

    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(7);

    act(() => {
      root.unmount();
    });
    root = createRoot(container);

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={apps}
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    expect(container.querySelectorAll("[data-chat-first-app]")).toHaveLength(7);
  });
});
