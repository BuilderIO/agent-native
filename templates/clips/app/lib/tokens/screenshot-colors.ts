/**
 * Colours painted into screenshot image files.
 *
 * Everything here ends up as pixels in a stored picture: mark colours,
 * redaction fills, background gradients, and the shadows and outlines drawn
 * with them. A picture has no light or dark mode, so none of these can follow
 * the theme tokens in `app/global.css`. The editor's own chrome uses those.
 */

/** What a box, arrow or text can be drawn in. A palette is a decision, not a colour picker. */
export const MARK_COLORS: readonly string[] = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#ffffff",
  "#000000",
];

/** The soft shadow that lifts a box off a busy picture. */
export const MARK_SHADOW = "rgba(15, 23, 42, 0.45)";

/** The outline behind text: light behind dark text, dark behind light text. */
export const TEXT_OUTLINE_BEHIND_DARK = "rgba(255, 255, 255, 0.75)";
export const TEXT_OUTLINE_BEHIND_LIGHT = "rgba(15, 23, 42, 0.75)";

/** Redaction black: unmistakably deliberate on light and dark screenshots. */
export const DEFAULT_SOLID_FILL = "#0b0f19";

/** What a solid redaction can be painted in, black first. */
export const SOLID_FILL_COLORS: readonly string[] = [
  DEFAULT_SOLID_FILL,
  "#ffffff",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
];

export interface BackgroundGradient {
  id: string;
  /** Top-left to bottom-right. */
  stops: readonly string[];
  /** A soft glow laid over the gradient, which is what keeps it from looking flat. */
  glow: string;
}

export const BACKGROUND_GRADIENTS: readonly BackgroundGradient[] = [
  {
    id: "indigo",
    stops: ["#5b5ef0", "#6b4fd8", "#9b4a8f"],
    glow: "rgba(120, 130, 255, 0.55)",
  },
  {
    id: "peach",
    stops: ["#f7d9a6", "#f39a73", "#e06a6a"],
    glow: "rgba(255, 230, 200, 0.6)",
  },
  {
    id: "sunset",
    stops: ["#6c5ce7", "#f08a5d", "#f6c453"],
    glow: "rgba(255, 170, 90, 0.55)",
  },
  {
    id: "forest",
    stops: ["#5aa38c", "#2f6d6a", "#2b2f7a"],
    glow: "rgba(150, 210, 180, 0.45)",
  },
  {
    id: "plum",
    stops: ["#c0507a", "#8e44ad", "#4b3fa8"],
    glow: "rgba(230, 110, 160, 0.4)",
  },
  {
    id: "citrus",
    stops: ["#f07a52", "#f5c04a", "#8d82f0"],
    glow: "rgba(255, 210, 110, 0.5)",
  },
  {
    id: "sky",
    stops: ["#3a6fe0", "#9ad2e0", "#b8b8f0"],
    glow: "rgba(200, 235, 245, 0.55)",
  },
  {
    id: "lagoon",
    stops: ["#3f8f6e", "#3a78b0", "#8fc7c0"],
    glow: "rgba(160, 220, 210, 0.45)",
  },
  {
    id: "night",
    stops: ["#2b2f86", "#4a3aa8", "#8a4c8c"],
    glow: "rgba(110, 90, 220, 0.45)",
  },
];

export const BACKGROUND_COLORS: readonly string[] = [
  "#3b82f6",
  "#3a97b8",
  "#6a9a3a",
  "#b08a2e",
  "#c0579c",
  "#c0443a",
  "#d9702e",
  "#7b8496",
  "#111111",
  "#ffffff",
];

/** Where the gradient's glow fades to. */
export const GLOW_FADE = "rgba(0, 0, 0, 0)";

/** The shadow under the picture on a background, and the card behind it. */
export const BACKGROUND_CARD_SHADOW = "rgba(15, 23, 42, 0.35)";
export const BACKGROUND_CARD_FILL = "#ffffff";
