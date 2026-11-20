import type {
  ModelRow,
  RowBadge,
  ScreenModel,
} from "@agent-native/design-system/model";

import type { SettingsNavRowDetail } from "../../../design-system/agent-native-parts/settings-nav.js";
import type {
  SettingsPageContext,
  SettingsPageDefinition,
  SettingsPageGroup,
} from "./registry.js";
import type {
  AppSettingsNavigationItem,
  AppSettingsNavigationSection,
} from "./SettingsShell.js";
import type { SettingsPageIcon } from "./types.js";

export interface SettingsNavModelInput {
  pages: readonly SettingsPageDefinition[];
  allPages: readonly SettingsPageDefinition[];
  groups: readonly SettingsPageGroup[];
  activePageId: string | null;
  activeSub: string | null;
  unreadPageIds: readonly string[];
  context: SettingsPageContext;
  appNavigationSections?: readonly AppSettingsNavigationSection[] | undefined;
  navLabel: string;
  groupLabel: (group: SettingsPageGroup) => string;
  pageLabel: (page: SettingsPageDefinition) => string;
  pageIcon: (page: SettingsPageDefinition) => SettingsPageIcon;
  pageHref: (page: SettingsPageDefinition, sub: string | undefined) => string;
  linkHref: (href: string) => string;
}

/** What to do when a row runs, by row id. */
export type SettingsNavTarget =
  | { kind: "page"; pageId: string; sub: string | null }
  | { kind: "link"; href: string }
  | { kind: "action"; onSelect: () => void };

export interface SettingsNavModel {
  model: ScreenModel;
  details: ReadonlyMap<string, SettingsNavRowDetail>;
  targets: ReadonlyMap<string, SettingsNavTarget>;
}

export const SETTINGS_NAV_ACTION_PREFIX = "settings-nav:";

function segment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "item";
}

/**
 * The settings navigation as a screen model, with the same visibility,
 * selection, unread and href rules the nav applied when it drew its own
 * markup. Row ids: `settings.nav` for the nav, `settings.nav-group.<id>` for a
 * group or app section, `settings.nav.<page>[.<sub>]` for a page and
 * `settings.nav.<item-id>` for an app link or action. A page or item that
 * appears twice gets a `-2`, `-3` suffix in order, so ids stay unique.
 */
export function buildSettingsNavModel(
  input: SettingsNavModelInput,
): SettingsNavModel {
  const details = new Map<string, SettingsNavRowDetail>();
  const targets = new Map<string, SettingsNavTarget>();
  const used = new Set<string>();
  const uniqueId = (base: string) => {
    let id = base;
    for (let count = 2; used.has(id); count++) id = `${base}-${count}`;
    used.add(id);
    return id;
  };
  used.add("settings.nav");

  const hasVisibleSubpageEntry = (pageId: string) =>
    Boolean(
      input.activeSub &&
      input.appNavigationSections?.some(
        (section) =>
          (section.visibleWhen?.(input.context) ?? true) &&
          section.items.some(
            (candidate) =>
              candidate.type === "page" &&
              candidate.pageId === pageId &&
              candidate.sub === input.activeSub &&
              (candidate.visibleWhen?.(input.context) ?? true),
          ),
      ),
    );

  const pageRow = (
    page: SettingsPageDefinition,
    item?: Extract<AppSettingsNavigationItem, { type: "page" }>,
  ): ModelRow => {
    const sub = item?.sub;
    const id = uniqueId(
      sub === undefined
        ? `settings.nav.${segment(page.id)}`
        : `settings.nav.${segment(page.id)}.${segment(sub)}`,
    );
    const selected =
      page.id === input.activePageId &&
      (sub !== undefined
        ? sub === input.activeSub
        : input.activeSub === null || !hasVisibleSubpageEntry(page.id));
    const dataAttributes: Record<string, string> = {
      "data-settings-page": page.id,
    };
    if (item) dataAttributes["data-settings-nav-item"] = item.id;
    details.set(id, {
      behavior: "page",
      icon: item?.icon ?? input.pageIcon(page),
      statusIcon: item?.status?.icon,
      dataAttributes,
    });
    targets.set(id, { kind: "page", pageId: page.id, sub: sub ?? null });
    const status = item?.status;
    const unread = input.unreadPageIds.includes(page.id);
    const badge: RowBadge | undefined = status
      ? { kind: "label", value: status.label, tone: "attention" }
      : unread
        ? { kind: "dot" }
        : undefined;
    return {
      id,
      part: "settings.nav-item",
      kind: "destination",
      label: item?.label ?? input.pageLabel(page),
      icon: { kind: "symbol", key: page.id },
      ...(selected || badge
        ? {
            state: {
              ...(selected ? { selected: true } : {}),
              ...(badge ? { badge } : {}),
            },
          }
        : {}),
      effect: { kind: "navigate", to: input.pageHref(page, sub) },
    };
  };

  const navigationItemRow = (
    item: AppSettingsNavigationItem,
  ): ModelRow | null => {
    if (item.visibleWhen && !item.visibleWhen(input.context)) return null;
    if (item.type === "page") {
      const page = input.pages.find(
        (candidate) => candidate.id === item.pageId,
      );
      if (!page) {
        if (input.allPages.some((candidate) => candidate.id === item.pageId)) {
          return null;
        }
        throw new Error(
          `Settings navigation item "${item.id}" references unknown page "${item.pageId}".`,
        );
      }
      return pageRow(page, item);
    }
    const id = uniqueId(`settings.nav.${segment(item.id)}`);
    const disabled = Boolean(item.disabled);
    if (item.type === "link") {
      const href = input.linkHref(item.href);
      details.set(id, {
        behavior: "link",
        icon: item.icon,
        dataAttributes: { "data-settings-link": item.id },
      });
      targets.set(id, { kind: "link", href });
      return {
        id,
        part: "settings.nav-item",
        kind: "destination",
        label: item.label,
        ...(item.icon
          ? { icon: { kind: "symbol" as const, key: item.id } }
          : {}),
        ...(disabled ? { state: { disabled: true } } : {}),
        effect: { kind: "navigate", to: href },
      };
    }
    details.set(id, {
      behavior: "action",
      icon: item.icon,
      dataAttributes: { "data-settings-action": item.id },
    });
    targets.set(id, {
      kind: "action",
      onSelect: () => item.onSelect(input.context),
    });
    return {
      id,
      part: "settings.nav-item",
      kind: "action",
      label: item.label,
      ...(item.icon ? { icon: { kind: "symbol" as const, key: item.id } } : {}),
      ...(disabled ? { state: { disabled: true } } : {}),
      effect: {
        kind: "action",
        effectId: `${SETTINGS_NAV_ACTION_PREFIX}${id}`,
      },
    };
  };

  const groupRow = (
    groupId: string,
    label: string,
    rows: ModelRow[],
  ): ModelRow | null => {
    if (rows.length === 0) return null;
    const id = uniqueId(`settings.nav-group.${segment(groupId)}`);
    details.set(id, {
      behavior: "group",
      dataAttributes: { "data-settings-group": groupId },
    });
    return {
      id,
      part: "settings.nav-group",
      kind: "section",
      label,
      rows,
    };
  };

  const groups: ModelRow[] = [];
  if (input.appNavigationSections) {
    for (const section of input.appNavigationSections) {
      if (section.visibleWhen && !section.visibleWhen(input.context)) continue;
      const rows = section.items.flatMap((item) => {
        const row = navigationItemRow(item);
        return row ? [row] : [];
      });
      const group = groupRow(section.id, section.label, rows);
      if (group) groups.push(group);
    }
  } else {
    for (const group of input.groups) {
      const rows = input.pages
        .filter((page) => page.group === group)
        .map((page) => pageRow(page));
      const row = groupRow(group, input.groupLabel(group), rows);
      if (row) groups.push(row);
    }
  }

  const rows: ModelRow[] =
    groups.length === 0
      ? []
      : [
          {
            id: "settings.nav",
            part: "settings.nav",
            kind: "section",
            label: input.navLabel,
            rows: groups,
          },
        ];
  if (groups.length > 0) {
    details.set("settings.nav", { behavior: "group", dataAttributes: {} });
  }
  return { model: { id: "settings", rows }, details, targets };
}
