import { defineAction, fail } from "@agent-native/core/action";
import { getFusionDeploys } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import "../server/db/index.js";
import { readFusionApp } from "../shared/full-app.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default defineAction({
  description:
    "Read-only: check the status of a fusion (full-app) design's last hosted " +
    "deploy (queued|building|migrating|uploading|deploying|live|failed|" +
    "canceled). Call after deploy-builder-app to poll for completion. Makes no " +
    "database writes.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
  }),
  readOnly: true,
  dedupe: false,
  http: { method: "GET" },
  run: async ({ designId }, ctx) => {
    if (!(await isFullAppBuildingEnabled(ctx))) {
      fail("Full app building is not enabled", {
        errorCode: "full_app_building_disabled",
        statusCode: 412,
      });
    }

    const access = await assertAccess("design", designId, "editor");
    const fusionApp = readFusionApp(
      (access.resource as { data?: unknown }).data,
    );
    if (!fusionApp) {
      fail("This design has no Builder app. Call create-builder-app first.", {
        errorCode: "builder_app_missing",
        statusCode: 412,
      });
    }
    if (!fusionApp.lastDeployId) {
      fail(
        "This Builder app has not been deployed yet. Call deploy-builder-app first.",
        { errorCode: "builder_app_not_deployed", statusCode: 404 },
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
