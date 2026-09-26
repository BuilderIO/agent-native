/**
 * Where each Mail setting lives. The agent's `navigate` action, in-app links,
 * and both Settings pages (the redesigned shell and today's tabs) read this
 * one map, so a section id means the same place everywhere.
 */

import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "@agent-native/core/navigation";

/** Mail's own areas: tabs on Mail › General at `/settings/app/<id>`. */
export const MAIL_SETTINGS_AREA_IDS = [
  "drafting",
  "snippets",
  "rules",
  "ai-filter",
  "gmail-filters",
  "aliases",
  "tracking",
] as const;

export type MailSettingsAreaId = (typeof MAIL_SETTINGS_AREA_IDS)[number];

/** What `?section=` and the navigate action's `settingsSection` can name. */
export const MAIL_SETTINGS_SECTIONS = [
  "general",
  ...MAIL_SETTINGS_AREA_IDS,
  "slack",
  "members",
] as const;

export type MailSettingsSection = (typeof MAIL_SETTINGS_SECTIONS)[number];

// Today's tab ids too, so links written before the areas existed still land.
// Mail's inbox rules were the "automations" tab; core's Automations page is
// the agent's scheduled automations, a different thing.
const SECTION_BY_ALIAS: Readonly<Record<string, MailSettingsSection>> = {
  general: "general",
  drafting: "drafting",
  snippets: "snippets",
  rules: "rules",
  automations: "rules",
  "ai-filter": "ai-filter",
  "gmail-filters": "gmail-filters",
  aliases: "aliases",
  tracking: "tracking",
  slack: "slack",
  members: "members",
  team: "members",
};

// Where each section lives in today's tabbed Settings.
const LEGACY_TAB_BY_SECTION: Readonly<Record<MailSettingsSection, string>> = {
  general: "general",
  drafting: "drafting",
  snippets: "snippets",
  rules: "automations",
  "ai-filter": "ai-filter",
  "gmail-filters": "gmail-filters",
  aliases: "aliases",
  tracking: "tracking",
  slack: "slack",
  members: "organization",
};

const AREA_IDS: ReadonlySet<string> = new Set(MAIL_SETTINGS_AREA_IDS);

export function isMailSettingsArea(id: string): id is MailSettingsAreaId {
  return AREA_IDS.has(id);
}

export function mailSettingsSectionFor(
  section: string | null | undefined,
): MailSettingsSection | null {
  if (!section) return null;
  return SECTION_BY_ALIAS[section.trim().toLowerCase()] ?? null;
}

/**
 * The Settings route for a Mail section. Anything that isn't one of Mail's
 * (`integrations`, `agent`) goes to core's route builder, whose redirect
 * table knows today's ids.
 */
export function mailSettingsRoute(section: string): string {
  const resolved = mailSettingsSectionFor(section);
  if (!resolved) return buildSettingsRoute(section);
  if (resolved === "general") return buildSettingsRoute("app");
  if (resolved === "slack") return buildSettingsRoute("channels", "slack");
  if (resolved === "members") return buildSettingsRoute("members");
  return buildSettingsRoute("app", resolved);
}

/**
 * Where a `?section=` link goes in the redesigned Settings, or null when it
 * isn't one of Mail's (the shell resolves core ids itself).
 */
export function mailSettingsRedirect(
  section: string | null | undefined,
): string | null {
  const resolved = mailSettingsSectionFor(section);
  return resolved ? mailSettingsRoute(resolved) : null;
}

function settingsSegments(pathname: string): string[] | null {
  const prefix = STANDARD_APP_ROUTES.settings;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length).split("/").filter(Boolean);
}

/** The Mail section a redesigned Settings path shows, if any. */
export function mailSettingsSectionFromPath(
  pathname: string,
): MailSettingsSection | undefined {
  const segments = settingsSegments(pathname);
  if (!segments) return undefined;
  const [page, sub] = segments;
  if (page === "app") {
    if (!sub) return "general";
    return isMailSettingsArea(sub) ? sub : undefined;
  }
  if (page === "channels" && sub === "slack") return "slack";
  if (page === "members") return "members";
  return undefined;
}

/**
 * Today's tab for a path the redesigned routes use, when today's tabs can't
 * resolve that path themselves (`/settings/app/rules` would open General).
 */
export function legacyMailSettingsTabForPath(pathname: string): string | null {
  const section = mailSettingsSectionFromPath(pathname);
  if (!section || section === "general" || section === "members") return null;
  return LEGACY_TAB_BY_SECTION[section];
}

/** Today's tab id for a `?section=` value, or null when Mail doesn't know it. */
export function legacyMailSettingsTab(
  section: string | null | undefined,
): string | null {
  const resolved = mailSettingsSectionFor(section);
  return resolved ? LEGACY_TAB_BY_SECTION[resolved] : null;
}
