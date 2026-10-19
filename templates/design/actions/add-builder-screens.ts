import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import {
  DEFAULT_FUSION_SCREEN_HEIGHT,
  DEFAULT_FUSION_SCREEN_WIDTH,
  upsertFusionScreens,
} from "../server/lib/fusion-screens.js";
import { readFusionApp } from "../shared/full-app.js";

export default defineAction({
  description:
    "Add or refresh URL-backed screens on a fusion (full-app) design's " +
    "canvas, pointing at the container's live preview URL. Requires the " +
    "fusion app to already have a previewUrl (call sync-builder-app first if " +
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
  run: async ({ designId, paths, width, height }, ctx) => {
    if (!(await isFullAppBuildingEnabled(ctx))) {
      fail("Full app building is not enabled", {
        errorCode: "full_app_building_disabled",
        statusCode: 412,
      });
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const fusionApp = readFusionApp(design.data);
    if (!fusionApp) {
      fail("This design has no Builder app. Call create-builder-app first.", {
        errorCode: "builder_app_missing",
        statusCode: 412,
      });
    }
    if (!fusionApp.previewUrl) {
      fail(
        "The Builder app has no preview URL yet. Call sync-builder-app first to boot the container and resolve its preview URL.",
        { errorCode: "builder_app_not_ready", statusCode: 412 },
      );
    }

    await snapshotDesignBeforeAgentEdit(designId, ctx);
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
