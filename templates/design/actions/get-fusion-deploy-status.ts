/**
 * get-fusion-deploy-status — read-only poll of a fusion app's last deploy.
 *
 * No DB writes: reads the persisted lastDeployId/deployedUrl off the fusion
 * app linkage and asks Builder for the current deploy status.
 */

import { defineAction } from "@agent-native/core";
import { getFusionDeploys } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
    "Read-only: check the status of a fusion (full-app) design's last hosted " +
    "deploy (queued|building|migrating|uploading|deploying|live|failed|" +
    "canceled). Call after deploy-fusion-app to poll for completion. Makes no " +
    "database writes.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const db = getDb();
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designs.id, designId),
        ),
      )
      .limit(1);
    if (!design) {
      const err = new Error("Design not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }

    const fusionApp = readFusionApp(design.data);
    if (!fusionApp) {
      throw new Error(
        "This design has no fusion app linkage. Call create-fusion-app first.",
      );
    }
    if (!fusionApp.lastDeployId) {
      throw new Error(
        "This fusion app has not been deployed yet. Call deploy-fusion-app first.",
      );
    }

    const deploys = await getFusionDeploys({
      projectId: fusionApp.projectId,
      deployId: fusionApp.lastDeployId,
    });
    const deploy = deploys[0];
    const status =
      asString(deploy?.status) ?? fusionApp.lastDeployStatus ?? "unknown";

    return {
      deployId: fusionApp.lastDeployId,
      status,
      url: fusionApp.deployedUrl ?? null,
    };
  },
});
