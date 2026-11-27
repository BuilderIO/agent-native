import { validateModel } from "@agent-native/design-system/model";
import type { ModelRow } from "@agent-native/design-system/model";
import { describe, expect, it, vi } from "vitest";

import type {
  SettingsPageContext,
  SettingsPageDefinition,
} from "./registry.js";
import {
  buildSettingsNavModel,
  type SettingsNavModelInput,
} from "./settings-nav-model.js";
import type { AppSettingsNavigationSection } from "./SettingsShell.js";

const Icon = () => null;

function page(
  id: string,
  group: SettingsPageDefinition["group"],
  extra: Partial<SettingsPageDefinition> = {},
): SettingsPageDefinition {
  return {
    id,
    group,
    label: id,
    icon: Icon,
    component: () => null,
    ...extra,
  } as SettingsPageDefinition;
}

const pages = [
  page("profile", "account"),
  page("preferences", "account"),
  page("model", "agent"),
  page("app", "app"),
];

function input(
  overrides: Partial<SettingsNavModelInput> = {},
): SettingsNavModelInput {
  return {
    pages,
    allPages: pages,
    groups: ["account", "connections", "agent", "organization", "app"],
    activePageId: "profile",
    activeSub: null,
    unreadPageIds: [],
    context: {} as SettingsPageContext,
    navLabel: "Settings",
    groupLabel: (group) => `Group ${group}`,
    pageLabel: (definition) => `Page ${definition.id}`,
    pageIcon: () => Icon,
    pageHref: (definition, sub) =>
      sub ? `/settings/${definition.id}/${sub}` : `/settings/${definition.id}`,
    linkHref: (href) => `/mounted${href}`,
    ...overrides,
  };
}

function flat(rows: readonly ModelRow[]): ModelRow[] {
  return rows.flatMap((row) => [row, ...flat(row.rows ?? [])]);
}

describe("buildSettingsNavModel", () => {
  it("groups pages in group order, skips empty groups, and validates", () => {
    const { model } = buildSettingsNavModel(input());
    expect(validateModel(model)).toEqual([]);
    const nav = model.rows.at(0);
    expect(nav).toMatchObject({
      id: "settings.nav",
      part: "settings.nav",
      label: "Settings",
    });
    expect(nav?.rows?.map((group) => [group.id, group.label])).toEqual([
      ["settings.nav-group.account", "Group account"],
      ["settings.nav-group.agent", "Group agent"],
      ["settings.nav-group.app", "Group app"],
    ]);
    expect(flat(model.rows).map((row) => row.id)).toContain("settings.nav.app");
  });

  it("marks the active page selected and unread pages with a dot", () => {
    const { model } = buildSettingsNavModel(
      input({ unreadPageIds: ["model"] }),
    );
    const rows = flat(model.rows);
    expect(
      rows.find((row) => row.id === "settings.nav.profile")?.state,
    ).toEqual({
      selected: true,
    });
    expect(rows.find((row) => row.id === "settings.nav.model")?.state).toEqual({
      badge: { kind: "dot" },
    });
    expect(
      rows.find((row) => row.id === "settings.nav.preferences")?.state,
    ).toBeUndefined();
    expect(rows.find((row) => row.id === "settings.nav.model")?.effect).toEqual(
      {
        kind: "navigate",
        to: "/settings/model",
      },
    );
  });

  it("shows a page entry's status in place of its unread dot", () => {
    const StatusIcon = () => null;
    const { model, details } = buildSettingsNavModel(
      input({
        unreadPageIds: ["app"],
        appNavigationSections: [
          {
            id: "accounts",
            label: "Accounts",
            items: [
              {
                id: "account-alpha",
                type: "page",
                pageId: "app",
                status: { icon: StatusIcon, label: "Needs reconnecting" },
              },
            ],
          },
        ],
      }),
    );
    expect(validateModel(model)).toEqual([]);
    const row = flat(model.rows).find(
      (candidate) => candidate.id === "settings.nav.app",
    );
    expect(row?.state).toEqual({
      badge: { kind: "label", value: "Needs reconnecting", tone: "attention" },
    });
    expect(details.get("settings.nav.app")?.statusIcon).toBe(StatusIcon);
  });

  it("selects a sub-page entry, and the page entry only when no visible entry names the sub", () => {
    const sections: AppSettingsNavigationSection[] = [
      {
        id: "main",
        label: "Main",
        items: [
          { id: "general", type: "page", pageId: "app" },
          {
            id: "drafting",
            type: "page",
            pageId: "app",
            sub: "drafting",
            label: "Drafting",
          },
        ],
      },
    ];
    const onSub = buildSettingsNavModel(
      input({
        appNavigationSections: sections,
        activePageId: "app",
        activeSub: "drafting",
      }),
    );
    const onSubRows = flat(onSub.model.rows);
    expect(
      onSubRows.find((row) => row.id === "settings.nav.app")?.state?.selected,
    ).toBeUndefined();
    expect(
      onSubRows.find((row) => row.id === "settings.nav.app.drafting")?.state,
    ).toEqual({
      selected: true,
    });
    expect(onSub.targets.get("settings.nav.app.drafting")).toEqual({
      kind: "page",
      pageId: "app",
      sub: "drafting",
    });

    const onOther = buildSettingsNavModel(
      input({
        appNavigationSections: sections,
        activePageId: "app",
        activeSub: "unlisted",
      }),
    );
    expect(
      flat(onOther.model.rows).find((row) => row.id === "settings.nav.app")
        ?.state,
    ).toEqual({ selected: true });
  });

  it("draws app links and actions, honours visibleWhen, and skips hidden pages", () => {
    const onSelect = vi.fn();
    const sections: AppSettingsNavigationSection[] = [
      {
        id: "Tools & More",
        label: "Tools",
        items: [
          { id: "Docs Link", type: "link", label: "Docs", href: "/docs" },
          {
            id: "sign-out",
            type: "action",
            label: "Sign out",
            onSelect,
            disabled: true,
          },
          { id: "hidden", type: "page", pageId: "secret" },
          {
            id: "never",
            type: "link",
            label: "Never",
            href: "/x",
            visibleWhen: () => false,
          },
        ],
      },
      { id: "gone", label: "Gone", items: [], visibleWhen: () => false },
    ];
    const allPages = [...pages, page("secret", "app")];
    const result = buildSettingsNavModel(
      input({ appNavigationSections: sections, allPages }),
    );
    expect(validateModel(result.model)).toEqual([]);
    const rows = flat(result.model.rows);
    expect(rows.map((row) => row.id)).toEqual([
      "settings.nav",
      "settings.nav-group.tools-more",
      "settings.nav.docs-link",
      "settings.nav.sign-out",
    ]);
    expect(rows[2]?.effect).toEqual({ kind: "navigate", to: "/mounted/docs" });
    expect(rows[3]).toMatchObject({
      kind: "action",
      state: { disabled: true },
    });
    const target = result.targets.get("settings.nav.sign-out");
    if (target?.kind !== "action") throw new Error("expected an action target");
    target.onSelect();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(
      result.details.get("settings.nav-group.tools-more")?.dataAttributes,
    ).toEqual({
      "data-settings-group": "Tools & More",
    });
  });

  it("throws for an item naming a page that does not exist", () => {
    expect(() =>
      buildSettingsNavModel(
        input({
          appNavigationSections: [
            {
              id: "main",
              label: "Main",
              items: [{ id: "x", type: "page", pageId: "nope" }],
            },
          ],
        }),
      ),
    ).toThrow(/references unknown page "nope"/);
  });

  it("keeps ids unique when a page is listed twice", () => {
    const { model } = buildSettingsNavModel(
      input({
        appNavigationSections: [
          {
            id: "main",
            label: "Main",
            items: [
              { id: "a", type: "page", pageId: "model" },
              { id: "b", type: "page", pageId: "model" },
            ],
          },
        ],
      }),
    );
    expect(validateModel(model)).toEqual([]);
    expect(flat(model.rows).map((row) => row.id)).toContain(
      "settings.nav.model-2",
    );
  });

  it("returns no rows when nothing is visible", () => {
    expect(buildSettingsNavModel(input({ pages: [] })).model.rows).toEqual([]);
  });
});
