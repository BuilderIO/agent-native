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

// Older editor tabs still read and update these fields.
export const storedViewSettingsSchema = viewSettingsSchema.extend({
  tweaksPanelOpen: z.boolean(),
  tweaksPanelCollapsed: z.boolean(),
  tweaksPanelPosition: z.object({ x: z.number(), y: z.number() }),
});

const LEGACY_PANEL_DEFAULTS = {
  tweaksPanelOpen: true,
  tweaksPanelCollapsed: false,
  tweaksPanelPosition: { x: 16, y: 64 },
};

export function parseStoredViewSettings(
  stored: unknown,
): z.infer<typeof storedViewSettingsSchema> {
  const current = viewSettingsSchema.partial().parse(stored ?? {});
  const legacy = z
    .object({
      tweaksPanelOpen: storedViewSettingsSchema.shape.tweaksPanelOpen.catch(
        LEGACY_PANEL_DEFAULTS.tweaksPanelOpen,
      ),
      tweaksPanelCollapsed:
        storedViewSettingsSchema.shape.tweaksPanelCollapsed.catch(
          LEGACY_PANEL_DEFAULTS.tweaksPanelCollapsed,
        ),
      tweaksPanelPosition:
        storedViewSettingsSchema.shape.tweaksPanelPosition.catch(
          LEGACY_PANEL_DEFAULTS.tweaksPanelPosition,
        ),
    })
    .parse(stored ?? {});
  return {
    pixelGrid: current.pixelGrid ?? DEFAULT_VIEW_SETTINGS.pixelGrid,
    snapToPixelGrid:
      current.snapToPixelGrid ?? DEFAULT_VIEW_SETTINGS.snapToPixelGrid,
    rulers: current.rulers ?? DEFAULT_VIEW_SETTINGS.rulers,
    multiplayerCursors:
      current.multiplayerCursors ?? DEFAULT_VIEW_SETTINGS.multiplayerCursors,
    commentsHidden:
      current.commentsHidden ?? DEFAULT_VIEW_SETTINGS.commentsHidden,
    ...legacy,
  };
}
