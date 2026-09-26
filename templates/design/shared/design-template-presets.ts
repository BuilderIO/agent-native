import { displayLuxury } from "./design-template-presets/display-ad.js";
import { eventPoster } from "./design-template-presets/event-poster.js";
import { keynoteTitle } from "./design-template-presets/keynote-title.js";
import { landingDevtool } from "./design-template-presets/landing-devtool.js";
import { landingDtc } from "./design-template-presets/landing-dtc.js";
import { leaderboard } from "./design-template-presets/leaderboard.js";
import { LEGACY_DESIGN_TEMPLATE_PRESETS } from "./design-template-presets/legacy.js";
import { menuCard } from "./design-template-presets/menu-card.js";
import { onePagerEditorial } from "./design-template-presets/one-pager.js";
import { socialBrutalist } from "./design-template-presets/social-brutalist.js";
import { socialStory } from "./design-template-presets/social-story.js";
import { videoThumbnail } from "./design-template-presets/video-thumbnail.js";

export type DesignTemplateCategory =
  | "ad"
  | "one-pager"
  | "landing-page"
  | "social"
  | "presentation"
  | "other";

export interface DesignTemplatePreset {
  id: string;
  title: string;
  description: string;
  category: DesignTemplateCategory;
  width: number;
  height: number;
  filename: string;
  content: string;
}

/**
 * Built-in starters, in gallery order. Each new preset is hand-authored in its
 * own file with its own brand, typography, and composition; the original
 * generated starters follow at the end under their original ids. Every preset
 * carries exactly two locked layers (`template-background` and
 * `template-logo`) with inline styles.
 */
export const DESIGN_TEMPLATE_PRESETS: DesignTemplatePreset[] = [
  socialStory,
  keynoteTitle,
  landingDevtool,
  eventPoster,
  displayLuxury,
  onePagerEditorial,
  landingDtc,
  videoThumbnail,
  menuCard,
  socialBrutalist,
  leaderboard,
  ...LEGACY_DESIGN_TEMPLATE_PRESETS,
];

export function getDesignTemplatePreset(
  id: string,
): DesignTemplatePreset | undefined {
  return DESIGN_TEMPLATE_PRESETS.find((preset) => preset.id === id);
}
