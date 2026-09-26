import { defineAction } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { getFusionDeploys } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { FULL_APP_BUILDING, readFusionApp } from "../shared/full-app.js";

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
  run: async ({ designId }, ctx) => {
    if (!(await isFeatureFlagEnabled(FULL_APP_BUILDING, ctx))) {
      throw new Error("Full app building is not enabled");
    }

    const access = await assertAccess("design", designId, "editor");
    const fusionApp = readFusionApp(
      (access.resource as { data?: unknown }).data,
    );
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
