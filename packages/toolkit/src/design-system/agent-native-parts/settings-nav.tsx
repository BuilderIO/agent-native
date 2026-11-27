import type { ModelRow } from "@agent-native/design-system/model";
import {
  type ComponentType,
  createContext,
  type MouseEvent,
  useContext,
  useId,
} from "react";

import { Badge } from "../../ui/base-ui/badge.js";
import {
  NavigationMenu,
  NavigationMenuGroupLabel,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../ui/base-ui/navigation-menu.js";
import { SidebarContent } from "../../ui/base-ui/sidebar.js";
import { type PartComponent, rowAttributes, useRowEffect } from "../parts.js";

/**
 * What our settings nav parts need beyond the model: the icon component and
 * the DOM hooks existing code and tests select on. Kept out of the model,
 * which stays plain data any part set can draw its own way.
 */
export interface SettingsNavRowDetail {
  /** `page`: in-settings navigation; `link`: a plain link; `action`: a button. */
  behavior: "page" | "link" | "action" | "group";
  icon?: ComponentType<{ className?: string }> | undefined;
  /** Drawn for an `attention` label badge, which names it. */
  statusIcon?: ComponentType<{ className?: string }> | undefined;
  dataAttributes: Readonly<Partial<Record<string, string>>>;
}

export interface SettingsNavPartsContextValue {
  details: ReadonlyMap<string, SettingsNavRowDetail>;
  /** The unread dot's accessible name. */
  unreadLabel: string;
}

const SettingsNavPartsContext =
  createContext<SettingsNavPartsContextValue | null>(null);

export const SettingsNavPartsProvider = SettingsNavPartsContext.Provider;

function useDetail(rowId: string): SettingsNavRowDetail {
  const context = useContext(SettingsNavPartsContext);
  const detail = context?.details.get(rowId);
  if (!context || !detail) {
    throw new Error(
      `Settings nav row ${rowId} rendered without its SettingsNavPartsProvider detail`,
    );
  }
  return detail;
}

function useUnreadLabel(): string {
  const context = useContext(SettingsNavPartsContext);
  if (!context) {
    throw new Error("Settings nav parts need a SettingsNavPartsProvider");
  }
  return context.unreadLabel;
}

function isModifiedClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

const SettingsNav: PartComponent = ({ row, children }) => {
  const detail = useDetail(row.id);
  return (
    <SidebarContent
      render={<NavigationMenu orientation="vertical" />}
      {...rowAttributes(row)}
      {...detail.dataAttributes}
      aria-label={row.label}
    >
      {children}
    </SidebarContent>
  );
};

const SettingsNavGroup: PartComponent = ({ row, children }) => {
  const detail = useDetail(row.id);
  const labelId = useId();
  return (
    <div
      {...rowAttributes(row)}
      {...detail.dataAttributes}
      role="group"
      aria-labelledby={labelId}
    >
      <NavigationMenuGroupLabel id={labelId} data-rid-label="">
        {row.label}
      </NavigationMenuGroupLabel>
      <NavigationMenuList>{children}</NavigationMenuList>
    </div>
  );
};

function PageTrailing({
  row,
  detail,
}: {
  row: ModelRow;
  detail: SettingsNavRowDetail;
}) {
  const unreadLabel = useUnreadLabel();
  const badge = row.state?.badge;
  if (badge?.kind === "dot") return <Badge dot>{unreadLabel}</Badge>;
  if (badge?.kind === "label" && badge.tone === "attention") {
    const StatusIcon = detail.statusIcon;
    if (!StatusIcon) {
      throw new Error(`Settings page row ${row.id} has a status but no icon`);
    }
    return (
      <span
        role="img"
        aria-label={badge.value}
        title={badge.value}
        data-settings-nav-status=""
      >
        <StatusIcon />
      </span>
    );
  }
  return null;
}

const SettingsNavItem: PartComponent = ({ row }) => {
  const detail = useDetail(row.id);
  const run = useRowEffect(row);
  const href = row.effect?.kind === "navigate" ? row.effect.to : undefined;
  const disabled = Boolean(row.state?.disabled);
  const Icon = detail.icon;
  const leading = Icon ? <Icon /> : undefined;
  const attributes = { ...rowAttributes(row), ...detail.dataAttributes };

  if (detail.behavior === "page") {
    if (!Icon) throw new Error(`Settings page row ${row.id} has no icon`);
    return (
      <NavigationMenuItem>
        <NavigationMenuLink
          {...attributes}
          href={href}
          active={Boolean(row.state?.selected)}
          leading={leading}
          trailing={<PageTrailing row={row} detail={detail} />}
          onClick={(event) => {
            if (isModifiedClick(event)) return;
            event.preventDefault();
            run?.();
          }}
        >
          <span data-rid-label="">{row.label}</span>
        </NavigationMenuLink>
      </NavigationMenuItem>
    );
  }

  if (detail.behavior === "link") {
    return (
      <NavigationMenuItem>
        <NavigationMenuLink
          {...attributes}
          href={href}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          leading={leading}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <span data-rid-label="">{row.label}</span>
        </NavigationMenuLink>
      </NavigationMenuItem>
    );
  }

  return (
    <NavigationMenuItem>
      <NavigationMenuLink
        {...attributes}
        render={<button type="button" disabled={disabled} />}
        leading={leading}
        onClick={run}
      >
        <span data-rid-label="">{row.label}</span>
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
};

/** Toolkit's settings nav parts, keyed by part reference. */
export const SETTINGS_NAV_PARTS = {
  "settings.nav": SettingsNav,
  "settings.nav-group": SettingsNavGroup,
  "settings.nav-item": SettingsNavItem,
} as const satisfies Record<string, PartComponent>;
