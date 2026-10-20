import { defineAction, fail } from "@agent-native/core/action";
import { pushFusionBranch } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import "../server/db/index.js";
import { readFusionApp } from "../shared/full-app.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Push a fusion (full-app) design's branch code to its git remote. Use " +
    "when the user wants the current app code synced to git as a checkpoint " +
    "or before handing off elsewhere. Does not deploy or affect the live " +
    "container preview — use deploy-builder-app for a hosted deploy.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
  }),
  run: async ({ designId }, ctx) => {
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

    const record = await pushFusionBranch({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
    });

    const detail =
      asString(record.message) ??
      asString(record.commit) ??
      asString(record.sha) ??
      asString(record.status) ??
      JSON.stringify(record).slice(0, 500);

    return { ok: true as const, detail };
  },
});
