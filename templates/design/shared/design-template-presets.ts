import { analyticsDashboard } from "./design-template-presets/analytics-dashboard.js";
import { designStudio } from "./design-template-presets/design-studio.js";
import { displayLuxury } from "./design-template-presets/display-ad.js";
import { eventPoster } from "./design-template-presets/event-poster.js";
import { keynoteTitle } from "./design-template-presets/keynote-title.js";
import { landingDevtool } from "./design-template-presets/landing-devtool.js";
import { landingDtc } from "./design-template-presets/landing-dtc.js";
import { launchKit } from "./design-template-presets/launch-kit.js";
import { leaderboard } from "./design-template-presets/leaderboard.js";
import { LEGACY_DESIGN_TEMPLATE_PRESETS } from "./design-template-presets/legacy.js";
import { menuCard } from "./design-template-presets/menu-card.js";
import { messagingApp } from "./design-template-presets/messaging-app.js";
import { metricsDashboard } from "./design-template-presets/metrics-dashboard.js";
import { onboardingFlow } from "./design-template-presets/onboarding-flow.js";
import { onePagerEditorial } from "./design-template-presets/one-pager.js";
import { pitchDeck } from "./design-template-presets/pitch-deck.js";
import { pricingPage } from "./design-template-presets/pricing-page.js";
import { projectTasks } from "./design-template-presets/project-tasks.js";
import { releaseEmail } from "./design-template-presets/release-email.js";
import { socialBrutalist } from "./design-template-presets/social-brutalist.js";
import { socialStory } from "./design-template-presets/social-story.js";
import { startHere } from "./design-template-presets/start-here.js";
import { styleTile } from "./design-template-presets/style-tile.js";
import { videoThumbnail } from "./design-template-presets/video-thumbnail.js";
import { wireframeToPolished } from "./design-template-presets/wireframe.js";

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
  /** More frames placed beside the main one, for templates that come as a set. */
  frames?: DesignTemplatePresetFrame[];
}

export interface DesignTemplatePresetFrame {
  /** Stable within the preset; becomes part of the template file id. */
  key: string;
  filename: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
}

export interface DesignTemplatePresetFile {
  id: string;
  filename: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every file a preset creates, the main frame first at the origin. */
export function presetFiles(
  preset: DesignTemplatePreset,
): DesignTemplatePresetFile[] {
  return [
    {
      id: `file:${preset.id}`,
      filename: preset.filename,
      content: preset.content,
      x: 0,
      y: 0,
      width: preset.width,
      height: preset.height,
    },
    ...(preset.frames ?? []).map((frame) => ({
      id: `file:${preset.id}:${frame.key}`,
      filename: frame.filename,
      content: frame.content,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    })),
  ];
}

export const DESIGN_TEMPLATE_PRESETS: DesignTemplatePreset[] = [
  analyticsDashboard,
  messagingApp,
  projectTasks,
  designStudio,
  startHere,
  launchKit,
  pricingPage,
  metricsDashboard,
  onboardingFlow,
  pitchDeck,
  styleTile,
  releaseEmail,
  wireframeToPolished,
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
