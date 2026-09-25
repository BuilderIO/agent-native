import { buildSettingsRoute } from "@agent-native/core/client/navigation";

/** Brain's own areas, tabs on Brain › General at `/settings/app/<id>`. */
export const BRAIN_SETTINGS_AREA_IDS = [
  "identity",
  "behavior",
  "publishing",
  "safety",
  "privacy",
] as const;

export type BrainSettingsAreaId = (typeof BRAIN_SETTINGS_AREA_IDS)[number];

/** What `?section=` and the navigate action's `settingsSection` can name. */
export const BRAIN_SETTINGS_SECTIONS = [
  "general",
  ...BRAIN_SETTINGS_AREA_IDS,
] as const;

export type BrainSettingsSection = (typeof BRAIN_SETTINGS_SECTIONS)[number];

// Today's tab ids and card anchors, so links written before the areas existed
// open the same content in either Settings.
const SECTION_BY_ALIAS: Record<string, BrainSettingsSection> = {
  general: "general",
  identity: "identity",
  behavior: "behavior",
  "assistant-behavior": "behavior",
  publishing: "publishing",
  "publishing-review": "publishing",
  safety: "safety",
  "safety-evidence": "safety",
  privacy: "privacy",
  "privacy-sensitivity": "privacy",
};

// Where each section lives in today's tabs: Identity and Privacy are cards on
// the General tab.
const LEGACY_TAB_BY_SECTION: Record<BrainSettingsSection, string> = {
  general: "general",
  identity: "general",
  behavior: "assistant-behavior",
  publishing: "publishing-review",
  safety: "safety-evidence",
  privacy: "general",
};

export function brainSettingsSectionFor(
  section: string | null | undefined,
): BrainSettingsSection | null {
  if (!section) return null;
  return SECTION_BY_ALIAS[section] ?? null;
}

/**
 * The redesigned Settings route for a Brain section, or null when `section`
 * isn't one of Brain's (the shell resolves core ids like `team` itself).
 */
export function brainSettingsRedirect(
  section: string | null | undefined,
): string | null {
  const resolved = brainSettingsSectionFor(section);
  if (!resolved) return null;
  return resolved === "general"
    ? buildSettingsRoute("app")
    : buildSettingsRoute("app", resolved);
}

/** The Brain section a redesigned Settings path shows, if any. */
export function brainSettingsSectionFromPath(
  pathname: string,
): BrainSettingsSection | undefined {
  const match = pathname.match(/^\/settings\/app(?:\/([^/?#]+))?\/?$/);
  if (!match) return undefined;
  return brainSettingsSectionFor(match[1] ?? "general") ?? undefined;
}

export function createSettingsSectionIds(
  appSectionIds: Iterable<string>,
): Set<string> {
  return new Set([
    "general",
    "account",
    "team",
    "labs",
    "whats-new",
    ...appSectionIds,
  ]);
}

export function resolveSettingsSection(
  section: string | null,
  validSections: ReadonlySet<string>,
): string {
  if (!section) return "general";
  if (validSections.has(section)) return section;
  const brainSection = brainSettingsSectionFor(section);
  return brainSection ? LEGACY_TAB_BY_SECTION[brainSection] : "general";
}

export function withSettingsSection(
  search: URLSearchParams,
  section: string,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (section === "general") next.delete("section");
  else next.set("section", section);
  return next;
}
