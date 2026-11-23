// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@/components/settings/AnalyticsWorkspaceName", () => ({
  AnalyticsWorkspaceName: () =>
    createElement("div", null, "workspace-name-only"),
}));
vi.mock("@/components/settings/AnalyticsPreferencesPage", () => ({
  AnalyticsPreferencesPage: () =>
    createElement("div", null, "workspace-general-backed"),
}));
vi.mock("@/components/settings/AnalyticsAccountPreferences", () => ({
  AnalyticsAccountPreferencesPage: () =>
    createElement("div", null, "personal-preferences-backed"),
}));
import { resolveRoutePage } from "./pages";
let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
it.each([
  [true, "workspace-general-backed"],
  [false, "personal-preferences-backed"],
] as const)(
  "resolves General for an admin=%s without mounting the other role page",
  async (isAdmin, expected) => {
    const entry = resolveRoutePage(
      { id: "settings", view: "general" } as never,
      { isAdmin },
    );
    expect(entry).toBeDefined();
    if (!entry) throw new Error("General page is unregistered");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(entry.component, {
          route: { id: "settings", view: "general" } as never,
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(host.textContent).toBe(expected);
  },
);
import { MemoryRouter } from "react-router";

import { SettingsShell } from "./SettingsShell";
it("keeps backed Users and Groups reachable for a member without exposing admin pages", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          SettingsShell,
          {
            activeTab: "preferences",
            canManageWorkspace: false,
            children: "body",
          },
          "body",
        ),
      ),
    ),
  );
  const labels = [...host.querySelectorAll("nav a")].map((e) => e.textContent);
  expect(labels).toContain("Users");
  expect(labels).toContain("Groups");
  expect(labels).not.toContain("Organization");
  expect(labels).not.toContain("SSO");
  expect(labels).toContain("Notifications");
  expect(labels).toContain("Connected apps");
  expect(
    host.querySelector('nav a[href="/settings/compute"]')?.textContent,
  ).toBe("Compute");
});
it.each(["Preferences", "Users", "Connected apps"])(
  "shows a page heading for %s",
  async (title) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SettingsShell, {
            activeTab: title.toLowerCase().replaceAll(" ", "-"),
            canManageWorkspace: false,
            children: "Settings content",
          }),
        ),
      ),
    );
    expect(
      [...host.querySelectorAll("h1")].map((heading) => heading.textContent),
    ).toEqual([title]);
  },
);
it("offers the backed Context Studio route to an admin", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          SettingsShell,
          { activeTab: "general", canManageWorkspace: true, children: "body" },
          "body",
        ),
      ),
    ),
  );
  expect(
    [...host.querySelectorAll("nav a")]
      .find((e) => e.textContent === "Context Studio")
      ?.getAttribute("href"),
  ).toBe("/context-studio");
});

it.each([
  "organization",
  "data-sources",
  "secrets",
  "git-integrations",
  "sharing",
  "environment",
  "sso",
  "audit-logs",
  "trusted-mode",
])(
  "uses personal preferences for a non-admin deep link to %s",
  async (view) => {
    const fallback = resolveRoutePage(
      { id: "settings", view: "preferences" } as never,
      {
        isAdmin: false,
      },
    );
    expect(
      resolveRoutePage({ id: "settings", view } as never, { isAdmin: false })
        ?.component,
    ).toBe(fallback?.component);
  },
);
