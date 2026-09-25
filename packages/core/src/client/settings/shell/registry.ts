import type { ComponentType } from "react";

import type { OrgRole } from "../../../org/types.js";
import type { SettingsBridge } from "./bridge.js";

export type SettingsPageIcon = ComponentType<{ className?: string }>;

/** Nav groups, top to bottom. `footer` holds Labs and What's new. */
export const SETTINGS_PAGE_GROUPS = [
  "account",
  "connections",
  "agent",
  "organization",
  "app",
  "footer",
] as const;

export type SettingsPageGroup = (typeof SETTINGS_PAGE_GROUPS)[number];

/**
 * Stable page ids. They are URL segments (`/settings/:page/:sub`), search
 * targets, and the agent's name for a page, so never rename one; add a
 * redirect instead.
 */
export const SETTINGS_PAGE_IDS = {
  profile: "profile",
  preferences: "preferences",
  security: "security",
  integrations: "integrations",
  apiKeys: "api-keys",
  model: "model",
  instructions: "instructions",
  memory: "memory",
  skills: "skills",
  files: "files",
  subAgents: "sub-agents",
  org: "org",
  members: "members",
  usage: "usage",
  auth: "auth",
  apps: "apps",
  infra: "infra",
  audit: "audit",
  app: "app",
  notifications: "notifications",
  automations: "automations",
  channels: "channels",
  mcp: "mcp",
  creativeContext: "creative-context",
  labs: "labs",
  whatsNew: "whats-new",
} as const;

export type CoreSettingsPageId =
  (typeof SETTINGS_PAGE_IDS)[keyof typeof SETTINGS_PAGE_IDS];

/** Settings opens here unless a link names a page (spec §3.2). */
export const DEFAULT_SETTINGS_PAGE_ID: CoreSettingsPageId = "profile";

/** Who is viewing, for page visibility. Presentation only; actions enforce roles. */
export interface SettingsPageContext {
  role: OrgRole | null;
  isOwner: boolean;
  /** Owner or admin of the active organization. */
  isAdmin: boolean;
  /** `null` when the viewer's organization couldn't be read. */
  hasOrganization: boolean | null;
  appId: string | null;
  labs: Readonly<Record<string, boolean>>;
  flags: Readonly<Record<string, boolean>>;
}

export interface SettingsPageSearchEntry {
  id: string;
  /** Core catalog key; wins over `label`. */
  labelKey?: string;
  /** Already translated label, for app-provided entries. */
  label?: string;
  keywords?: string;
  sub?: string;
  /** `SettingsRow` / `SettingsGroup` id to scroll to. */
  anchor?: string;
}

export interface SettingsSubpageDefinition {
  id: string;
  labelKey?: string;
  label?: string;
}

export interface SettingsPageProps {
  pageId: string;
  /** The `:sub` segment, for example `builder` in `/settings/integrations/builder`. */
  sub: string | null;
  context: SettingsPageContext;
  bridge: SettingsBridge;
}

export interface SettingsPageDefinition {
  id: string;
  group: SettingsPageGroup;
  /** Sort key inside the group. Core pages step by 10. */
  order: number;
  /** Core catalog key for the nav label and header title. */
  labelKey?: string;
  /** Already translated label, for app-provided pages. */
  label?: string;
  icon: SettingsPageIcon;
  visible?: (context: SettingsPageContext, bridge: SettingsBridge) => boolean;
  component: ComponentType<SettingsPageProps>;
  subpages?: readonly SettingsSubpageDefinition[];
  searchEntries?: readonly SettingsPageSearchEntry[];
  /** Rendered at the right of the sticky header. */
  primaryAction?: ComponentType<SettingsPageProps>;
  /**
   * Today's `SettingsTabItem` ids (and nested `a:b` ids) this page answers
   * for. The bridge renders the first matching template tab, and routing
   * resolves these ids to this page until the redirect table owns them.
   */
  legacyTabIds?: readonly string[];
  /** Nav link to a route outside Settings instead of a page. */
  href?: string;
  /** Extra search terms for the page itself. */
  keywords?: string;
}

const PAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function defineSettingsPage(
  definition: SettingsPageDefinition,
): SettingsPageDefinition {
  if (!PAGE_ID_PATTERN.test(definition.id)) {
    throw new Error(
      `Settings page ids are lowercase and hyphenated: ${definition.id}`,
    );
  }
  if (!definition.labelKey && !definition.label) {
    throw new Error(`Settings page ${definition.id} needs a labelKey or label`);
  }
  return Object.freeze({ ...definition });
}

const registry = new Map<string, SettingsPageDefinition>();
const listeners = new Set<() => void>();
let snapshot: readonly SettingsPageDefinition[] = [];

function publish() {
  snapshot = Object.freeze([...registry.values()]);
  for (const listener of listeners) listener();
}

/**
 * Register pages with the shell. Registering an id again replaces it, which
 * is how a page task swaps its bridged placeholder for the finished page and
 * how HMR reloads stay idempotent.
 */
export function registerSettingsPages(
  definitions: readonly SettingsPageDefinition[],
): void {
  for (const definition of definitions) {
    registry.set(definition.id, defineSettingsPage(definition));
  }
  publish();
}

export function unregisterSettingsPage(id: string): void {
  if (registry.delete(id)) publish();
}

export function getSettingsPages(): readonly SettingsPageDefinition[] {
  return snapshot;
}

export function subscribeSettingsPages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSettingsPageVisible(
  page: SettingsPageDefinition,
  context: SettingsPageContext,
  bridge: SettingsBridge,
): boolean {
  return page.visible ? page.visible(context, bridge) : true;
}

/**
 * Organization pages owners and admins manage. No organization means a solo
 * workspace the viewer owns; an organization that couldn't be read hides them.
 */
export function canManageOrganizationPages(
  context: SettingsPageContext,
): boolean {
  return context.isAdmin || context.hasOrganization === false;
}

export function sortSettingsPages(
  pages: readonly SettingsPageDefinition[],
): SettingsPageDefinition[] {
  const groupIndex = new Map(
    SETTINGS_PAGE_GROUPS.map((group, index) => [group, index]),
  );
  return [...pages].sort(
    (a, b) =>
      (groupIndex.get(a.group) ?? 0) - (groupIndex.get(b.group) ?? 0) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );
}

/** Test-only reset; not exported from the package entry. */
export function _resetSettingsPagesForTests(): void {
  registry.clear();
  publish();
}
