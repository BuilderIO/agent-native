// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultChatFirstCopy } from "../chat-first-copy.js";
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

  it("keeps app icons in color before any surface resolves", () => {
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

  it("can keep inactive app icons in color for the Dispatch launcher", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[{ id: "content", name: "Content" }]}
          activeTab="search"
          grayscaleInactiveIcons={false}
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
    ).toBe("true");
  });

  it("grays every app icon while a nav surface owns the rail", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeTab="search"
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    const icons = [
      ...container.querySelectorAll<HTMLElement>("[data-chat-first-app-icon]"),
    ];
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      expect(icon.className).toContain("grayscale");
      expect(
        icon
          .querySelector("[data-icon-inactive]")
          ?.getAttribute("data-icon-inactive"),
      ).toBe("true");
      expect(
        icon.closest("[data-chat-first-app]")?.className.split(" "),
      ).not.toContain("bg-sidebar-accent");
    }
  });

  it("grays every expanded app row while a nav surface owns the rail", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeTab="new-chat"
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-chat-first-app]"),
    ];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className.split(" ")).not.toContain("bg-sidebar-accent");
      expect(
        row.querySelector("[data-chat-first-app-icon]")?.className,
      ).toContain("grayscale");
    }
  });

  it("keeps the selected app active when a nav tab is not resolved", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "content", name: "Content" },
            { id: "analytics", name: "Analytics" },
          ]}
          activeAppId="analytics"
          collapsed
          onOpenApp={vi.fn()}
          renderIcon={(app, options) => (
            <span data-icon-inactive={options.isInactive}>{app.name}</span>
          )}
        />,
      );
    });

    expect(
      container.querySelector<HTMLElement>(
        '[data-app-id="analytics"] [data-chat-first-app-icon]',
      )?.className,
    ).not.toContain("grayscale");
    expect(
      container.querySelector<HTMLElement>(
        '[data-app-id="content"] [data-chat-first-app-icon]',
      )?.className,
    ).toContain("grayscale");
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

  it("opens collapsed app actions and reloads the selected app", async () => {
    const onReloadApp = vi.fn();
    const app = { id: "calendar", name: "Calendar" };

    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[app]}
          collapsed
          onOpenApp={vi.fn()}
          onReloadApp={onReloadApp}
          renderIcon={(item) => <span>{item.name}</span>}
        />,
      );
    });

    const appButton = container.querySelector<HTMLButtonElement>(
      '[data-app-id="calendar"]',
    );
    expect(appButton).not.toBeNull();

    await act(async () => {
      appButton?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 40,
          clientY: 40,
        }),
      );
      await Promise.resolve();
    });

    const reloadItem = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.trim() === "Reload app");
    expect(reloadItem).not.toBeUndefined();

    act(() => {
      reloadItem?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      reloadItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReloadApp).toHaveBeenCalledWith(app);
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

  describe("with sections", () => {
    const apps = [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `app-${index}`,
        name: `App ${index}`,
      })),
      { id: "mail", name: "Mail", source: "builtin" as const },
      { id: "clips", name: "Clips", source: "builtin" as const },
    ];
    const sections = [
      { id: "pinned", label: "Pinned", appIds: ["clips"] },
      {
        id: "apps",
        label: "Apps",
        appIds: apps.slice(0, 7).map((app) => app.id),
      },
      { id: "hosted", label: "Hosted apps", appIds: ["mail"] },
    ];
    const rowIds = (sectionId: string) =>
      [
        ...container.querySelectorAll<HTMLElement>(
          `[data-chat-first-app-section="${sectionId}"] [data-chat-first-app]`,
        ),
      ].map((row) => row.dataset.appId);

    function renderRail(
      props: Partial<React.ComponentProps<typeof ChatFirstAppsRail>> = {},
    ) {
      act(() => {
        root.render(
          <ChatFirstAppsRail
            apps={apps}
            sections={sections}
            onOpenApp={vi.fn()}
            renderIcon={(app) => <span>{app.name}</span>}
            {...props}
          />,
        );
      });
    }

    it("renders every row of each section in the host's order", () => {
      renderRail();

      expect(
        [
          ...container.querySelectorAll<HTMLElement>(
            "[data-chat-first-app-section]",
          ),
        ].map((section) => section.getAttribute("aria-label")),
      ).toEqual(["Pinned", "Apps", "Hosted apps"]);
      expect(rowIds("pinned")).toEqual(["clips"]);
      expect(rowIds("apps")).toEqual(apps.slice(0, 7).map((app) => app.id));
      expect(rowIds("hosted")).toEqual(["mail"]);
      expect(
        container.querySelector('[data-chat-first-app][draggable="true"]'),
      ).toBeNull();
      expect(container.querySelector("button[aria-expanded]")).toBeNull();
    });

    it("shows the same apps collapsed", () => {
      renderRail({
        collapsed: true,
        sections: [
          { id: "pinned", label: "Pinned", appIds: ["clips", "mail"] },
        ],
      });

      expect(
        [
          ...container.querySelectorAll<HTMLElement>("[data-chat-first-app]"),
        ].map((row) => row.dataset.appId),
      ).toEqual(["clips", "mail"]);
      expect(container.querySelector("[data-chat-first-all-apps]")).toBeNull();
    });

    it("offers pinning but no move actions in the row menu", async () => {
      const onLayoutChange = vi.fn();
      renderRail({
        layout: { pinnedIds: ["clips"], orderedIds: [] },
        onLayoutChange,
        copy: (key, values) =>
          key === "pinApp"
            ? `Pin ${values?.name}`
            : defaultChatFirstCopy(key, values),
      });

      await act(async () => {
        container
          .querySelector('[data-chat-first-app-section="hosted"] li')
          ?.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              button: 2,
              clientX: 40,
              clientY: 40,
            }),
          );
        await Promise.resolve();
      });
      const items = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].map((item) => item.textContent?.trim());
      expect(items).toContain("Pin Mail");
      expect(items).not.toContain("Pin app to the top");
      expect(items).not.toContain("Move up");
      expect(items).not.toContain("Move down");

      act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-chat-first-app-section="hosted"] button[aria-pressed]',
          )
          ?.click();
      });
      expect(onLayoutChange).toHaveBeenCalledWith({
        pinnedIds: ["mail", "clips"],
        orderedIds: [],
      });
    });

    it("hands pin changes to the host instead of a whole layout", () => {
      const onLayoutChange = vi.fn();
      const onTogglePinned = vi.fn();
      renderRail({
        layout: { pinnedIds: ["clips"], orderedIds: [] },
        onLayoutChange,
        onTogglePinned,
      });

      act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-chat-first-app-section="hosted"] button[aria-pressed]',
          )
          ?.click();
      });
      expect(onTogglePinned).toHaveBeenCalledWith("mail");
      expect(onLayoutChange).not.toHaveBeenCalled();
    });

    it("shows the Apps header, empty text and one create trigger with no apps", () => {
      const createTrigger = <button type="button" data-create-app />;
      renderRail({
        apps: [],
        sections: sections.map((section) =>
          section.id === "apps"
            ? { ...section, action: createTrigger, emptyLabel: "No apps yet" }
            : section,
        ),
        createAppTrigger: createTrigger,
        copy: (key, values) =>
          key === "workspaceApps"
            ? "Workspace apps"
            : defaultChatFirstCopy(key, values),
      });

      expect(
        [
          ...container.querySelectorAll<HTMLElement>(
            "[data-chat-first-app-section]",
          ),
        ].map((section) => section.getAttribute("aria-label")),
      ).toEqual(["Apps"]);
      expect(container.textContent).toContain("No apps yet");
      expect(container.textContent).not.toContain("Workspace apps");
      expect(container.querySelectorAll("[data-create-app]")).toHaveLength(1);
    });

    it("shows a section's empty label only when the host passes one", () => {
      const withEmptyLabel = (emptyLabel?: string) =>
        sections.map((section) =>
          section.id === "apps"
            ? { ...section, appIds: [], ...(emptyLabel ? { emptyLabel } : {}) }
            : section,
        );
      const appsSection = () =>
        container.querySelector('[data-chat-first-app-section="apps"]');

      renderRail({ sections: withEmptyLabel("No workspace apps") });
      expect(appsSection()?.textContent).toContain("No workspace apps");
      expect(rowIds("pinned")).toEqual(["clips"]);

      renderRail({ sections: withEmptyLabel() });
      expect(appsSection()).toBeNull();
      expect(container.textContent).not.toContain("No apps yet");
    });
  });

  it("keeps the workspace apps header and empty create button without sections", () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[]}
          onOpenApp={vi.fn()}
          onCreateApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
          copy={(key, values) =>
            key === "workspaceApps"
              ? "Workspace apps"
              : defaultChatFirstCopy(key, values)
          }
        />,
      );
    });

    expect(container.textContent).toContain("Workspace apps");
    expect(container.textContent).toContain("No apps yet");
    expect(container.textContent).toContain("Create app");
  });

  it("keeps drag and move controls without sections", async () => {
    act(() => {
      root.render(
        <ChatFirstAppsRail
          apps={[
            { id: "calendar", name: "Calendar" },
            { id: "mail", name: "Mail" },
          ]}
          onOpenApp={vi.fn()}
          renderIcon={(app) => <span>{app.name}</span>}
        />,
      );
    });

    const row = container.querySelector<HTMLElement>('[data-app-id="mail"]');
    expect(row?.getAttribute("draggable")).toBe("true");
    await act(async () => {
      row?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 40,
          clientY: 40,
        }),
      );
      await Promise.resolve();
    });
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (item) => item.textContent?.trim(),
      ),
    ).toContain("Move up");
  });
});
