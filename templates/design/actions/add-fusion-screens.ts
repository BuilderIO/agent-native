/**
 * add-fusion-screens — place additional URL-backed screens for an already
 * synced fusion app.
 *
 * Use this to add more routes/screens to the canvas once the container is
 * ready (i.e. after sync-fusion-app has resolved a previewUrl). If the app
 * has not been synced yet, this throws with guidance to call sync-fusion-app.
 */

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  DEFAULT_FUSION_SCREEN_HEIGHT,
  DEFAULT_FUSION_SCREEN_WIDTH,
  upsertFusionScreens,
} from "../server/lib/fusion-screens.js";
import {
  FULL_APP_BUILDING_ENABLED,
  readFusionApp,
} from "../shared/full-app.js";

export default defineAction({
  description:
    "Add or refresh URL-backed screens on a fusion (full-app) design's " +
    "canvas, pointing at the container's live preview URL. Requires the " +
    "fusion app to already have a previewUrl (call sync-fusion-app first if " +
    "not). Use this to place additional routes the app agent has built " +
    "(e.g. '/settings', '/dashboard') as new overview screens.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    paths: z
      .array(z.string())
      .min(1)
      .describe(
        "Route paths to place as screens, e.g. ['/settings', '/dashboard'].",
      ),
    width: z
      .number()
      .positive()
      .optional()
      .describe("Iframe viewport width. Defaults to 1280."),
    height: z
      .number()
      .positive()
      .optional()
      .describe("Iframe viewport height. Defaults to 900."),
  }),
  run: async ({ designId, paths, width, height }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const fusionApp = readFusionApp(design.data);
    if (!fusionApp) {
      throw new Error(
        "This design has no fusion app linkage. Call create-fusion-app first.",
      );
    }
    if (!fusionApp.previewUrl) {
      throw new Error(
        "The fusion app has no preview URL yet. Call sync-fusion-app first " +
          "to boot the container and resolve its preview URL.",
      );
    }

    const { screens } = await upsertFusionScreens({
      designId,
      previewUrl: fusionApp.previewUrl,
      paths,
      width: width ?? DEFAULT_FUSION_SCREEN_WIDTH,
      height: height ?? DEFAULT_FUSION_SCREEN_HEIGHT,
    });

    return {
      screens: screens.map((screen) => ({
        fileId: screen.fileId,
        path: screen.path,
        url: screen.url,
        title: screen.title,
        width: screen.width,
        height: screen.height,
      })),
    };
  },
});
