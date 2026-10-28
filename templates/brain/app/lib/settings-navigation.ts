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

// The former tab ids and card anchors, so links written before the areas
// existed still open the same content.
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

export function brainSettingsSectionFor(
  section: string | null | undefined,
): BrainSettingsSection | null {
  if (!section) return null;
  return SECTION_BY_ALIAS[section] ?? null;
}

/**
 * The Settings route for a Brain section, or null when `section`
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

/** The Brain section a Settings path shows, if any. */
export function brainSettingsSectionFromPath(
  pathname: string,
): BrainSettingsSection | undefined {
  const match = pathname.match(/^\/settings\/app(?:\/([^/?#]+))?\/?$/);
  if (!match) return undefined;
  return brainSettingsSectionFor(match[1] ?? "general") ?? undefined;
}
