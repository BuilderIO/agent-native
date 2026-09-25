import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_SETTINGS_BRIDGE } from "./bridge.js";
import { CORE_SETTINGS_PAGES } from "./core-pages.js";
import {
  _resetSettingsPagesForTests,
  canManageOrganizationPages,
  defineSettingsPage,
  getSettingsPages,
  isSettingsPageVisible,
  registerSettingsPages,
  SETTINGS_PAGE_IDS,
  sortSettingsPages,
  type SettingsPageContext,
} from "./registry.js";

const Stub = () => null;

function context(overrides: Partial<SettingsPageContext> = {}) {
  return {
    role: "member",
    isOwner: false,
    isAdmin: false,
    hasOrganization: true,
    appId: "clips",
    labs: {},
    flags: {},
    ...overrides,
  } satisfies SettingsPageContext;
}

describe("settings page registry", () => {
  afterEach(() => _resetSettingsPagesForTests());

  it("rejects ids that aren't lowercase and hyphenated", () => {
    expect(() =>
      defineSettingsPage({
        id: "API Keys",
        group: "connections",
        order: 1,
        label: "API keys",
        icon: Stub,
        component: Stub,
      }),
    ).toThrow(/lowercase/);
  });

  it("replaces a page registered under the same id", () => {
    registerSettingsPages([
      {
        id: "model",
        group: "agent",
        order: 10,
        label: "A",
        icon: Stub,
        component: Stub,
      },
    ]);
    registerSettingsPages([
      {
        id: "model",
        group: "agent",
        order: 10,
        label: "B",
        icon: Stub,
        component: Stub,
      },
    ]);
    expect(getSettingsPages().map((page) => page.label)).toEqual(["B"]);
  });

  it("orders core pages as the spec's five groups plus the footer", () => {
    const ids = sortSettingsPages(CORE_SETTINGS_PAGES).map((page) => page.id);
    expect(ids).toEqual([
      "profile",
      "preferences",
      "security",
      "integrations",
      "api-keys",
      "model",
      "instructions",
      "memory",
      "skills",
      "files",
      "sub-agents",
      "org",
      "members",
      "usage",
      "auth",
      "apps",
      "infra",
      "audit",
      "app",
      "notifications",
      "automations",
      "channels",
      "mcp",
      "creative-context",
      "labs",
      "whats-new",
    ]);
    expect(new Set(ids)).toEqual(new Set(Object.values(SETTINGS_PAGE_IDS)));
  });

  it("hides the four admin Organization pages from members", () => {
    const visible = (ctx: SettingsPageContext) =>
      CORE_SETTINGS_PAGES.filter(
        (page) =>
          page.group === "organization" &&
          isSettingsPageVisible(page, ctx, EMPTY_SETTINGS_BRIDGE),
      ).map((page) => page.id);
    expect(visible(context())).toEqual(["org", "members", "usage"]);
    expect(visible(context({ role: "admin", isAdmin: true }))).toEqual([
      "org",
      "members",
      "usage",
      "auth",
      "apps",
      "infra",
      "audit",
    ]);
    expect(
      visible(context({ role: "owner", isOwner: true, isAdmin: true })),
    ).toHaveLength(7);
  });

  it("treats a viewer with no organization as its manager", () => {
    expect(
      canManageOrganizationPages(
        context({ role: null, hasOrganization: false }),
      ),
    ).toBe(true);
  });

  it("hides the admin pages when the organization couldn't be read", () => {
    expect(
      canManageOrganizationPages(
        context({ role: null, hasOrganization: null }),
      ),
    ).toBe(false);
  });
});
