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

// A missing record or key is a user who never changed it, so it takes the
// default; a stored value of the wrong type throws instead of being reset.
export function parseStoredViewSettings(stored: unknown): ViewSettings {
  const partial = viewSettingsSchema.partial().parse(stored ?? {});
  return { ...DEFAULT_VIEW_SETTINGS, ...partial };
}
