// @vitest-environment jsdom
import {
  captureRows,
  type ScreenModel,
} from "@agent-native/design-system/model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSurface } from "../parts.js";
import {
  type SettingsNavRowDetail,
  SettingsNavPartsProvider,
} from "./settings-nav.js";

afterEach(cleanup);

const Icon = () => <svg data-testid="icon" />;

const model: ScreenModel = {
  id: "settings",
  rows: [
    {
      id: "settings.nav",
      part: "settings.nav",
      kind: "section",
      label: "Settings",
      rows: [
        {
          id: "settings.nav-group.account",
          part: "settings.nav-group",
          kind: "section",
          label: "Account",
          rows: [
            {
              id: "settings.nav.profile",
              part: "settings.nav-item",
              kind: "destination",
              label: "Profile",
              state: { selected: true },
              effect: { kind: "navigate", to: "/settings/profile" },
            },
            {
              id: "settings.nav.whats-new",
              part: "settings.nav-item",
              kind: "destination",
              label: "What's new",
              state: { badge: { kind: "dot" } },
              effect: { kind: "navigate", to: "/settings/whats-new" },
            },
            {
              id: "settings.nav.docs",
              part: "settings.nav-item",
              kind: "destination",
              label: "Docs",
              effect: { kind: "navigate", to: "/docs" },
            },
            {
              id: "settings.nav.off-link",
              part: "settings.nav-item",
              kind: "destination",
              label: "Off",
              state: { disabled: true },
              effect: { kind: "navigate", to: "/off" },
            },
            {
              id: "settings.nav.sign-out",
              part: "settings.nav-item",
              kind: "action",
              label: "Sign out",
              effect: { kind: "action", effectId: "sign-out" },
            },
          ],
        },
      ],
    },
  ],
};

const details = new Map<string, SettingsNavRowDetail>([
  ["settings.nav", { behavior: "group", dataAttributes: {} }],
  [
    "settings.nav-group.account",
    { behavior: "group", dataAttributes: { "data-settings-group": "account" } },
  ],
  [
    "settings.nav.profile",
    {
      behavior: "page",
      icon: Icon,
      dataAttributes: { "data-settings-page": "profile" },
    },
  ],
  [
    "settings.nav.whats-new",
    {
      behavior: "page",
      icon: Icon,
      dataAttributes: { "data-settings-page": "whats-new" },
    },
  ],
  [
    "settings.nav.docs",
    { behavior: "link", dataAttributes: { "data-settings-link": "docs" } },
  ],
  [
    "settings.nav.off-link",
    { behavior: "link", dataAttributes: { "data-settings-link": "off" } },
  ],
  [
    "settings.nav.sign-out",
    {
      behavior: "action",
      icon: Icon,
      dataAttributes: { "data-settings-action": "sign-out" },
    },
  ],
]);

function renderNav() {
  const navigate = vi.fn();
  const signOut = vi.fn();
  render(
    <SettingsNavPartsProvider value={{ details, unreadLabel: "Unread" }}>
      <ModelSurface
        model={model}
        navigate={navigate}
        actions={{ "sign-out": signOut }}
      />
    </SettingsNavPartsProvider>,
  );
  return { navigate, signOut };
}

describe("settings nav parts", () => {
  it("draws the nav, group label and items with the nav's own hooks", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(nav.dataset.rid).toBe("settings.nav");
    expect(nav.classList).toContain("navigation-menu");
    expect(nav.classList).toContain("sidebar-content");
    const group = screen.getByRole("group", { name: "Account" });
    expect(group.dataset.settingsGroup).toBe("account");
    expect(group.firstElementChild?.classList).toContain(
      "navigation-menu-group-label",
    );
    expect(
      group.querySelector(":scope > .navigation-menu-list"),
    ).not.toBeNull();
    const profile = screen.getByRole("link", { name: "Profile" });
    expect(profile.classList).toContain("navigation-menu-link");
    expect(profile.getAttribute("aria-current")).toBe("page");
    expect(profile.hasAttribute("data-active")).toBe(true);
    expect(profile.dataset.settingsPage).toBe("profile");
    expect(
      profile.querySelector(".navigation-menu-link-leading svg"),
    ).not.toBeNull();
    const unread = screen.getByRole("link", { name: /What's new/ });
    const dot = unread.querySelector(".navigation-menu-link-trailing .badge");
    expect(dot?.hasAttribute("data-dot")).toBe(true);
    expect(dot?.textContent).toBe("Unread");
    expect(
      captureRows(document).map((row) => [row.id, row.name, row.parentId]),
    ).toEqual([
      ["settings.nav", "Settings", null],
      ["settings.nav-group.account", "Account", "settings.nav"],
      ["settings.nav.profile", "Profile", "settings.nav-group.account"],
      ["settings.nav.whats-new", "What's new", "settings.nav-group.account"],
      ["settings.nav.docs", "Docs", "settings.nav-group.account"],
      ["settings.nav.off-link", "Off", "settings.nav-group.account"],
      ["settings.nav.sign-out", "Sign out", "settings.nav-group.account"],
    ]);
  });

  it("navigates a page in place, but leaves a modified click to the browser", () => {
    const { navigate } = renderNav();
    const profile = screen.getByRole("link", { name: "Profile" });
    expect(fireEvent.click(profile)).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      "/settings/profile",
      expect.objectContaining({ id: "settings.nav.profile" }),
    );
    expect(fireEvent.click(profile, { metaKey: true })).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("lets a link navigate natively and stops a disabled one", () => {
    const { navigate } = renderNav();
    const docs = screen.getByRole("link", { name: "Docs" });
    expect(docs.getAttribute("href")).toBe("/docs");
    expect(fireEvent.click(docs)).toBe(true);
    const off = screen.getByRole("link", { name: "Off" });
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(fireEvent.click(off)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("runs an action item's effect", () => {
    const { signOut } = renderNav();
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.classList).toContain("navigation-menu-link");
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("refuses to draw a row without its detail", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <SettingsNavPartsProvider
          value={{ details: new Map(), unreadLabel: "Unread" }}
        >
          <ModelSurface model={model} navigate={vi.fn()} />
        </SettingsNavPartsProvider>,
      ),
    ).toThrow(/without its SettingsNavPartsProvider detail/);
  });
});
