/**
 * push-fusion-app — push a fusion branch's code to its git remote.
 *
 * Use when the user wants the in-progress app code synced to git (e.g. before
 * handing off to another tool, or as a checkpoint) without necessarily
 * deploying it.
 */

import { defineAction } from "@agent-native/core";
import { pushFusionBranch } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  FULL_APP_BUILDING_ENABLED,
  readFusionApp,
} from "../shared/full-app.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default defineAction({
  description:
    "Push a fusion (full-app) design's branch code to its git remote. Use " +
    "when the user wants the current app code synced to git as a checkpoint " +
    "or before handing off elsewhere. Does not deploy or affect the live " +
    "container preview — use deploy-fusion-app for a hosted deploy.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
  }),
  run: async ({ designId }) => {
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
