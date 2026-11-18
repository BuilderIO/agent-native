import { z } from "zod";

export const VIEW_SETTINGS_KEY = "design-view-settings";

export const viewSettingsSchema = z.object({
  pixelGrid: z
    .boolean()
    .describe("Show the pixel grid when zoomed in to 800% or more."),
  snapToPixelGrid: z
    .boolean()
    .describe("Snap canvas drags and resizes to whole pixels."),
  rulers: z.boolean().describe("Show rulers along the overview board edges."),
  multiplayerCursors: z
    .boolean()
    .describe("Show other collaborators' live cursors."),
  commentsHidden: z.boolean().describe("Hide comment pins on the canvas."),
});

export type ViewSettings = z.infer<typeof viewSettingsSchema>;

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  pixelGrid: true,
  snapToPixelGrid: true,
  rulers: false,
  multiplayerCursors: true,
  commentsHidden: false,
};

// Older editor tabs still require these fields in both action responses.
const storedViewSettingsSchema = viewSettingsSchema.extend({
  tweaksPanelOpen: z.boolean(),
  tweaksPanelCollapsed: z.boolean(),
  tweaksPanelPosition: z.object({ x: z.number(), y: z.number() }),
});

const LEGACY_PANEL_DEFAULTS = {
  tweaksPanelOpen: true,
  tweaksPanelCollapsed: false,
  tweaksPanelPosition: { x: 16, y: 64 },
};

// A missing record or key is a user who never changed it, so it takes the
// default; a stored value of the wrong type throws instead of being reset.
export function parseStoredViewSettings(
  stored: unknown,
): z.infer<typeof storedViewSettingsSchema> {
  const partial = storedViewSettingsSchema.partial().parse(stored ?? {});
  return { ...DEFAULT_VIEW_SETTINGS, ...LEGACY_PANEL_DEFAULTS, ...partial };
}
