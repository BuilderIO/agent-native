// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
import enUS from "../../i18n/en-US";
import { SettingsShell } from "./SettingsShell";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
function Location() {
  return createElement("output", null, useLocation().pathname);
}
it("report M5-T2-F-04: searches only accessible settings and opens the selected route", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/preferences"] },
        createElement(SettingsShell, {
          activeTab: "preferences",
          canManageWorkspace: false,
          children: createElement(Location),
        }),
      ),
    ),
  );
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="analytics.settingsSearch.open"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => trigger?.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="analytics.settingsSearch.placeholder"]',
  );
  expect(input).not.toBeNull();
  expect(enUS.analytics.settingsSearch.placeholder).toBe("Search...");
  expect(document.body.textContent).not.toContain("Organization");
  const users = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] [role="option"]',
    ),
  ].find((button) => button.textContent?.includes("Users"));
  expect(users).toBeDefined();
  await act(async () => users?.click());
  expect(host.querySelector("output")?.textContent).toBe("/settings/users");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(["pointer", "shortcut"] as const)(
  "report A2-SETTINGS-SEARCH-POINTER-FOCUS: restores the opener after %s activation",
  async (mode) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SettingsShell, {
            activeTab: "preferences",
            canManageWorkspace: false,
            children: createElement("input", {
              "aria-label": "Previous focus",
            }),
          }),
        ),
      ),
    );
    const previous = host.querySelector<HTMLInputElement>(
      'input[aria-label="Previous focus"]',
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="analytics.settingsSearch.open"]',
    );
    if (!previous || !trigger) throw new Error("Missing settings controls");
    previous.focus();
    await act(async () => {
      if (mode === "pointer") trigger.click();
      else
        previous.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
          }),
        );
    });
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        mode === "pointer" ? trigger : previous,
      ),
    );
  },
);

function SearchPage() {
  const path = useLocation().pathname;
  return createElement(SettingsShell, {
    activeTab: path.split("/").at(-1) ?? "preferences",
    canManageWorkspace: true,
    children: path.endsWith("notifications")
      ? createElement(
          "div",
          {
            "data-rid": "settings.notifications.desktop-notifications",
            "data-part": "settings.row",
          },
          "Desktop notifications",
        )
      : createElement(Location),
  });
}
it("finds Theme in Preferences and scrolls to its controls", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Page() {
    const path = useLocation().pathname;
    return createElement(SettingsShell, {
      activeTab: path.split("/").at(-1) ?? "profile",
      canManageWorkspace: false,
      children: path.endsWith("preferences")
        ? createElement("section", { id: "settings.preferences.theme" })
        : null,
    });
  }
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/profile"] },
        createElement(Page),
      ),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("nav button")?.click(),
  );
  const input = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input',
  );
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "theme");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const result = document.querySelector<HTMLElement>('[role="option"]');
  expect(result?.textContent).toContain("Preferences >");
  expect(result?.textContent?.toLowerCase()).toContain("theme");
  await act(async () => result?.click());
  const target = document.getElementById("settings.preferences.theme");
  expect(target).toBeTruthy();
  expect(scroll.mock.instances).toContain(target);
  scroll.mockRestore();
});

it("searches a settings section and scrolls to it after navigating", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/preferences"] },
        createElement(SearchPage),
      ),
    ),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="analytics.settingsSearch.open"]',
      )
      ?.click(),
  );
  const section = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) =>
    item.textContent?.includes(
      "analytics.settings.notifications.desktopNotifications",
    ),
  );
  expect(section).toBeDefined();
  await act(async () => section?.click());
  const target = host.querySelector(
    '[data-rid="settings.notifications.desktop-notifications"]',
  );
  expect(target).not.toBeNull();
  expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  expect(scroll.mock.instances).toContain(target);
  scroll.mockRestore();
});

function DelayedSearchPage() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  const [showTarget, setShowTarget] = useState(false);
  return createElement(SettingsShell, {
    activeTab: path.split("/").at(-1) ?? "preferences",
    canManageWorkspace: true,
    children: createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => setShowTarget(true) },
        "Mount target",
      ),
      createElement(
        "button",
        { onClick: () => void navigate("/settings/preferences") },
        "Leave page",
      ),
      showTarget &&
        createElement(
          "div",
          {
            "data-rid": "settings.notifications.desktop-notifications",
            "data-part": "settings.row",
          },
          "Desktop notifications",
        ),
    ),
  });
}
it.each([false, true])(
  "report M5-T2-F-04: handles late target and route departure (leave=%s)",
  async (leave) => {
    let frame: FrameRequestCallback | undefined;
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frame = callback;
        return 1;
      });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {
        frame = undefined;
      });
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/settings/preferences"] },
          createElement(DelayedSearchPage),
        ),
      ),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="analytics.settingsSearch.open"]',
        )
        ?.click(),
    );
    const section = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) =>
      item.textContent?.includes(
        "analytics.settings.notifications.desktopNotifications",
      ),
    );
    expect(section).toBeDefined();
    await act(async () => section?.click());
    expect(frame).toBeDefined();
    if (leave)
      await act(async () =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent === "Leave page")
          ?.click(),
      );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Mount target")
        ?.click(),
    );
    await act(async () => frame?.(performance.now()));
    if (leave)
      expect(scroll.mock.instances).not.toContain(
        host.querySelector(
          '[data-rid="settings.notifications.desktop-notifications"]',
        ),
      );
    else
      expect(scroll.mock.instances).toContain(
        host.querySelector(
          '[data-rid="settings.notifications.desktop-notifications"]',
        ),
      );
    request.mockRestore();
    cancel.mockRestore();
    scroll.mockRestore();
  },
);

it("report M5-T2-F-04: selects both a section and its setting when they share a target", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/preferences"] },
        createElement(SettingsShell, {
          activeTab: "preferences",
          canManageWorkspace: true,
          children: createElement("div", {
            "data-rid": "settings.preferences.full-width-cells",
            "data-part": "settings.row",
          }),
        }),
      ),
    ),
  );
  for (const label of [
    "editorPreferences.behavior",
    "editorPreferences.fullWidthCells",
  ]) {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="analytics.settingsSearch.open"]',
        )
        ?.click(),
    );
    const result = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent?.includes(label));
    expect(result).toBeDefined();
    scroll.mockClear();
    await act(async () => result?.click());
    expect(scroll.mock.instances).toContain(
      host.querySelector('[data-rid="settings.preferences.full-width-cells"]'),
    );
  }
  scroll.mockRestore();
});

it("row 462: indexes Git package import, Git project export, and Git repo syncing in settings search", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/git-integrations"] },
        createElement(SettingsShell, {
          activeTab: "git-integrations",
          canManageWorkspace: true,
          children: createElement(
            "div",
            null,
            createElement("section", {
              id: "settings-integrations-git-package-import",
            }),
            createElement("section", {
              id: "settings-integrations-git-project-export",
            }),
            createElement("section", {
              id: "settings-integrations-git-repo-syncing",
            }),
          ),
        }),
      ),
    ),
  );
  const expected: readonly [string, string][] = [
    [
      "analytics.settingsSearch.gitPackageImport",
      "settings-integrations-git-package-import",
    ],
    [
      "analytics.settingsSearch.gitProjectExport",
      "settings-integrations-git-project-export",
    ],
    [
      "analytics.settingsSearch.gitRepoSyncing",
      "settings-integrations-git-repo-syncing",
    ],
  ];
  for (const [label, sectionId] of expected) {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="analytics.settingsSearch.open"]',
        )
        ?.click(),
    );
    const result = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent?.includes(label));
    expect(result).toBeDefined();
    scroll.mockClear();
    await act(async () => result?.click());
    expect(scroll.mock.instances).toContain(
      host.querySelector(`#${sectionId}`),
    );
  }
  scroll.mockRestore();
});

it("QA-1795030602-ORG-CUSTOMIZATION: indexes Organization Auto-archive, Asset statuses, and Asset categories on /settings/organization", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function OrgPage() {
    const path = useLocation().pathname;
    return createElement(SettingsShell, {
      activeTab: path.split("/").at(-1) ?? "organization",
      canManageWorkspace: true,
      children: createElement(
        "div",
        null,
        createElement("output", null, path),
        createElement("section", { id: "settings-organization-auto-archive" }),
        createElement("section", { id: "settings-organization-statuses" }),
        createElement("section", { id: "settings-organization-categories" }),
      ),
    });
  }
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/organization"] },
        createElement(OrgPage),
      ),
    ),
  );
  const expected: readonly [string, string][] = [
    [
      "Organization > analytics.organizationArchive.title",
      "settings-organization-auto-archive",
    ],
    [
      "Organization > analytics.settingsSearch.assetStatuses",
      "settings-organization-statuses",
    ],
    [
      "Organization > analytics.settingsSearch.assetCategories",
      "settings-organization-categories",
    ],
  ];
  for (const [label, sectionId] of expected) {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="analytics.settingsSearch.open"]',
        )
        ?.click(),
    );
    const result = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent?.includes(label));
    expect(result).toBeDefined();
    scroll.mockClear();
    await act(async () => result?.click());
    expect(host.querySelector("output")?.textContent).toBe(
      "/settings/organization",
    );
    expect(scroll.mock.instances).toContain(
      host.querySelector(`#${sectionId}`),
    );
  }
  scroll.mockRestore();
});
