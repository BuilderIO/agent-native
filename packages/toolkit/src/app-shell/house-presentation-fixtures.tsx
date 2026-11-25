import {
  IconBell,
  IconChevronLeft,
  IconHelp,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconWriting,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { defineDesignSystem } from "../design-system/definition.js";
import { AGENT_NATIVE_PART_SET } from "../design-system/parts.js";
import { ToolkitProvider } from "../provider.js";
import type {
  NavigationEntry,
  NavigationModel,
  NavigationSection,
  ShellActionEffect,
  SidebarPartProps,
} from "./contracts.js";
import { shellTags } from "./shell-testing.js";
import {
  ModelSidebar,
  ShellHostProvider,
  useShellHost,
  type ShellGeneratedOwnerProps,
} from "./sidebar-shell.js";

const id = (key: string, order: number) => ({
  id: key,
  order,
  containerId: "presentation",
  part: "sidebar" as const,
  subPart: "sidebar.item" as const,
});
const symbols = {
  search: IconSearch,
  write: IconWriting,
  help: IconHelp,
  back: IconChevronLeft,
  home: IconHome,
  settings: IconSettings,
  add: IconPlus,
  bell: IconBell,
};
function WorkspaceHeader({ children }: ShellGeneratedOwnerProps) {
  return (
    <div
      data-presentation-header
      className="flex w-full min-w-0 items-center gap-1"
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-start text-sm"
        onClick={() => {}}
      >
        Example workspace
      </button>
      {children}
    </div>
  );
}
/** Independent, deliberately small alternate renderer for the four presentation fixtures. */
export function HousePresentationAlternate({
  model,
  effects,
}: SidebarPartProps) {
  const host = useShellHost();
  const entry = (item: NavigationEntry, iconOnly = false): ReactNode => {
    if (item.visible === false) return null;
    const Icon =
      item.icon?.kind === "symbol"
        ? symbols[item.icon.key as keyof typeof symbols]
        : undefined;
    const leading = item.search?.leadingIcon;
    const Leading =
      leading?.kind === "symbol"
        ? symbols[leading.key as keyof typeof symbols]
        : undefined;
    const effect =
      item.effect?.kind === "action"
        ? effects.find(
            (e) =>
              item.effect?.kind === "action" && e.id === item.effect.effectId,
          )
        : undefined;
    const name = item.accessibleLabel ?? item.label;
    const navigation =
      item.effect?.kind === "navigate" ? item.effect : undefined;
    const Control = navigation ? "a" : "button";
    const dense = model.presentation.density === "compact";
    return (
      <div key={item.id} className={iconOnly ? "contents" : "min-w-0"}>
        {item.search ? (
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-2 flex items-center"
            >
              {Leading && (
                <span
                  data-shell-symbol={
                    leading?.kind === "symbol" ? leading.key : undefined
                  }
                >
                  <Leading className="size-4" />
                </span>
              )}
            </span>
            <input
              {...shellTags(item, item.subPart, item.containerId)}
              aria-label={name}
              type="search"
              placeholder={item.search.placeholder}
              value={item.search.binding.value}
              onChange={(e) => item.search?.binding.set?.(e.target.value)}
              className="h-7 w-full rounded-md border border-input bg-background ps-9 text-[13px]"
            />
          </div>
        ) : (
          <Control
            {...shellTags(item, item.subPart, item.containerId)}
            {...(navigation
              ? { href: navigation.to }
              : {
                  type: "button" as const,
                  disabled: item.disabled || effect?.pending,
                })}
            data-shell-action={effect?.actionName}
            aria-label={name}
            onClick={(event) => {
              if (navigation) {
                event.preventDefault();
                host.navigate?.(navigation);
              } else void effect?.run();
            }}
            className={
              iconOnly
                ? "flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
                : `flex w-full items-center gap-2 rounded-md px-2 text-start ${dense ? "h-7 text-[13px] font-normal" : "h-9 text-sm"}`
            }
          >
            {Icon && (
              <span
                data-shell-symbol={
                  item.icon?.kind === "symbol" ? item.icon.key : undefined
                }
              >
                <Icon className="size-4 shrink-0" />
              </span>
            )}
            <span className={iconOnly ? "sr-only" : "min-w-0 flex-1 truncate"}>
              {item.label}
            </span>
          </Control>
        )}
      </div>
    );
  };
  const section = (group: NavigationSection) => {
    const controls = [...group.entries]
      .sort((a, b) => a.order - b.order)
      .map((e) => entry(e, group.presentation?.layout === "inline-icons"));
    return (
      <section
        key={group.id}
        {...shellTags(group, group.subPart, group.containerId)}
        aria-label={group.label}
        className={
          group.presentation?.layout === "inline-icons"
            ? "flex min-w-0 items-center gap-1 py-1"
            : "grid gap-0 py-1"
        }
      >
        {group.composition ? (
          <WorkspaceHeader identity={group} header={null}>
            {controls}
          </WorkspaceHeader>
        ) : (
          <>
            {group.label && (
              <h2 className="px-2 text-xs text-muted-foreground">
                {group.label}
              </h2>
            )}
            {controls}
          </>
        )}
      </section>
    );
  };
  return (
    <nav
      data-part="sidebar"
      data-look="alternate"
      aria-label="Navigation"
      className="flex h-full max-w-full flex-col border-e border-border bg-muted/30 p-2 text-foreground"
      style={{ width: model.presentation.width }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {[...model.sections, ...model.entries]
          .sort((a, b) => a.order - b.order)
          .map((group) => ("entries" in group ? section(group) : entry(group)))}
      </div>
    </nav>
  );
}
export function HousePresentationFixture({
  look = "house",
}: {
  look?: "house" | "alternate";
}) {
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const action = (
    key: string,
    label: string,
    icon: string,
    order: number,
  ): NavigationEntry => ({
    ...id(key, order),
    kind: "action",
    label,
    icon: { kind: "symbol", key: icon },
    effect: { kind: "action", effectId: key },
  });
  const search = action("search", "Search", "search", 0);
  const write = action("write", "Compose", "write", 1);
  const tools = [
    action("help", "Help", "help", 0),
    action("settings", "Settings", "settings", 1),
    action("add", "Create", "add", 2),
    action("bell", "Notifications", "bell", 3),
  ];
  const rows: NavigationEntry[] = [
    action("home", "Home", "home", 0),
    {
      ...action("inbox", "Inbox", "bell", 1),
      kind: "destination",
      effect: { kind: "navigate", to: "/inbox" },
    },
    { ...action("workspace", "Workspace", "home", 2), kind: "identity" },
  ];
  const effects: ShellActionEffect[] = [search, write, ...tools, ...rows]
    .filter((e) => e.effect?.kind === "action")
    .map((e) => ({
      id: e.id,
      kind: "action",
      actionName: e.id,
      run: () => setEvents((v) => [...v, e.id]),
    }));
  const model: NavigationModel = {
    presentation: {
      collapsed: { value: false },
      mobileOpen: { value: false },
      peekOpen: false,
      profile: "fixture",
      themeFamily: "fixture",
      visibility: "visible",
      width: 244,
      density: "compact",
    },
    entries: [
      {
        ...id("find", 2),
        kind: "filter",
        label: "Find settings",
        search: {
          binding: { value: query, set: setQuery },
          placeholder: "Search settings",
          match: "resolved",
          leadingIcon: { kind: "symbol", key: "search" },
        },
      },
    ],
    sections: [
      {
        ...id("header", 0),
        subPart: "sidebar.header",
        entries: [write, search],
        hideIfEmpty: false,
        presentation: { layout: "inline-icons" },
        composition: { ownerKey: "workspace" },
      },
      {
        ...id("compact", 1),
        subPart: "sidebar.section",
        label: "Workspace",
        entries: rows,
        hideIfEmpty: false,
        presentation: { density: "compact" },
      },
      {
        ...id("footer", 3),
        subPart: "sidebar.footer",
        entries: tools,
        hideIfEmpty: false,
        presentation: { layout: "inline-icons" },
      },
    ],
  };
  return (
    <ToolkitProvider
      {...(look === "alternate"
        ? {
            designSystem: defineDesignSystem({
              name: "house-alternate",
              parts: {
                name: "house-alternate",
                parts: AGENT_NATIVE_PART_SET.parts,
                whole: { sidebar: HousePresentationAlternate },
              },
            }),
          }
        : {})}
    >
      <ShellHostProvider
        value={{
          pathname: "/",
          symbols,
          generatedOwners: { workspace: WorkspaceHeader },
          navigate: () => setEvents((v) => [...v, "inbox"]),
          labels: { navigation: "Navigation" },
        }}
      >
        <div data-presentation-frame className="flex h-[520px] w-[244px]">
          <ModelSidebar model={model} effects={effects} />
        </div>
        <output aria-label="Fixture actions">{events.join(",")}</output>
      </ShellHostProvider>
    </ToolkitProvider>
  );
}
