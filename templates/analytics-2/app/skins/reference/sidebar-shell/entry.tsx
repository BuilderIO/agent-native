import {
  runShellAction,
  shellConditionState,
  type NavigationEntry,
  type ShellActionEffect,
  type ShellEffect,
  type ShellCondition,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import * as Icons from "@tabler/icons-react";
import { Link } from "react-router";

const symbols = {
  login: Icons.IconLogin,
  external: Icons.IconArrowUpRight,
  archive: Icons.IconArchive,
  book: Icons.IconBook,
  database: Icons.IconDatabase,
  dots: Icons.IconDots,
  file: Icons.IconFileText,
  folder: Icons.IconFolder,
  home: Icons.IconHome,
  project: Icons.IconLayoutDashboard,
  collections: Icons.IconLayoutGrid,
  thread: Icons.IconMessageCircle,
  threads: Icons.IconMessages,
  search: Icons.IconSearch,
  settings: Icons.IconSettings,
  stack: Icons.IconStack2,
  tasks: Icons.IconChecklist,
  trash: Icons.IconTrash,
  branch: Icons.IconGitBranch,
  automation: Icons.IconSettingsAutomation,
  plus: Icons.IconPlus,
  upload: Icons.IconUpload,
  adjustments: Icons.IconAdjustments,
  palette: Icons.IconPalette,
  history: Icons.IconHistory,
  activity: Icons.IconActivity,
  mail: Icons.IconMail,
  copy: Icons.IconCopy,
  arrow: Icons.IconArrowRight,
  logout: Icons.IconLogout,
  world: Icons.IconWorld,
  chart: Icons.IconChartLine,
  bulb: Icons.IconBulb,
  flask: Icons.IconFlask,
  rosette: Icons.IconRosette,
  certificate: Icons.IconCertificate,
  share: Icons.IconShare3,
  link: Icons.IconLink,
  user: Icons.IconUserCircle,
  bell: Icons.IconBell,
  key: Icons.IconKey,
  bolt: Icons.IconBolt,
  tag: Icons.IconTag,
  tags: Icons.IconTags,
  lock: Icons.IconLock,
  api: Icons.IconApi,
  package: Icons.IconPackage,
  cpu: Icons.IconCpu,
  calendar: Icons.IconCalendar,
  users: Icons.IconUsers,
  usersGroup: Icons.IconUsersGroup,
  refresh: Icons.IconRefresh,
  shield: Icons.IconShield,
  shieldLock: Icons.IconShieldLock,
  sparkles: Icons.IconSparkles,
  plug: Icons.IconPlug,
  sitemap: Icons.IconSitemap,
};

export function EntryIcon({
  entry,
  hidden,
  size = 16,
  stroke,
}: {
  entry: NavigationEntry;
  hidden?: boolean;
  size?: number;
  stroke?: number;
}) {
  if (!entry.icon) return null;
  if (entry.icon.kind !== "symbol")
    throw new Error(`Expected symbol icon for ${entry.id}`);
  if (!(entry.icon.key in symbols))
    throw new Error(`Unknown sidebar symbol: ${entry.icon.key}`);
  const Icon = symbols[entry.icon.key as keyof typeof symbols];
  return (
    <Icon
      size={size}
      {...(stroke === undefined ? {} : { stroke })}
      aria-hidden={hidden ? "true" : undefined}
    />
  );
}

export function selected(entry: NavigationEntry) {
  if (!entry.active || entry.active.kind === "none") return false;
  if (entry.active.kind !== "resolved")
    throw new Error(`Host must resolve active state: ${entry.id}`);
  return entry.active.value;
}

export function visible<T extends ShellCondition & { order: number }>(
  entries: readonly T[],
) {
  return entries
    .filter((entry) => shellConditionState(entry).visible)
    .sort((a, b) => a.order - b.order);
}

export function group(entries: readonly NavigationEntry[], container: string) {
  return visible(entries.filter((entry) => entry.containerId === container));
}

export function required(
  entries: readonly NavigationEntry[],
  container: string,
) {
  const matches = group(entries, container);
  if (matches.length !== 1)
    throw new Error(`Expected one entry in ${container}`);
  const match = matches[0];
  if (!match) throw new Error(`Missing entry in ${container}`);
  return match;
}

export function openBinding(entry: NavigationEntry) {
  if (entry.effect?.kind !== "open")
    throw new Error(`Expected open intent: ${entry.id}`);
  return entry.effect.open;
}

export function invoke(
  effect: ShellEffect | undefined,
  effects: readonly ShellActionEffect[],
) {
  if (
    !effect ||
    effect.kind === "none" ||
    effect.kind === "navigate" ||
    effect.kind === "external"
  )
    return;
  if (effect.kind === "open") effect.open.set?.(!effect.open.value);
  else void runShellAction(effects, effect.effectId, effect.input);
}

export function NavigationRow({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  if (!shellConditionState(entry).visible) return null;
  if (entry.effect?.kind !== "navigate")
    throw new Error(`Expected navigation intent: ${entry.id}`);
  return (
    <Link
      to={entry.effect.to}
      state={entry.effect.state}
      className={["ws-nav-row", selected(entry) ? "is-active" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-current={selected(entry) ? "page" : undefined}
      onClick={() => {
        for (const action of entry.trailingActions ?? [])
          invoke(action.effect, effects);
      }}
    >
      <EntryIcon entry={entry} hidden />
      <span className="ws-nav-label">{entry.label}</span>
    </Link>
  );
}

export function MenuRow({
  entry,
  effects,
  close,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
  close?: () => void;
}) {
  if (!shellConditionState(entry).visible) return null;
  const className = `ws-menu-item${selected(entry) ? " is-active" : ""}`;
  const children = (
    <>
      <EntryIcon entry={entry} />
      <span className="ws-menu-label">{entry.label}</span>
      {entry.metadata?.current ? (
        <span className="ws-menu-trailing">
          <Icons.IconCheck size={16} />
        </span>
      ) : null}
    </>
  );
  if (entry.effect?.kind === "navigate")
    return (
      <Link
        role="menuitem"
        data-menu-item="true"
        className={className}
        to={entry.effect.to}
        state={entry.effect.state}
        onClick={() => {
          close?.();
          for (const action of entry.trailingActions ?? [])
            invoke(action.effect, effects);
        }}
      >
        {children}
      </Link>
    );
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item="true"
      disabled={shellConditionState(entry).disabled}
      title={entry.tooltip}
      className={className}
      onClick={() => {
        close?.();
        invoke(entry.effect, effects);
      }}
    >
      {children}
    </button>
  );
}
