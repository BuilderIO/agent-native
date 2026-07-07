/**
 * send-fusion-message — relay a freeform prompt to the fusion app's
 * in-container coding agent.
 *
 * This is how the Design agent hands off user requests that go beyond
 * discrete queued visual edits — e.g. "add a new page", "wire up this API",
 * "fix this bug" — to the app's own coding agent for fusion-backed designs.
 * Unlike queue-fusion-edit/apply-fusion-edits (which batch small visual
 * tweaks), this sends immediately and does not persist a design_fusion_edits
 * row.
 */

import { defineAction } from "@agent-native/core";
import { sendFusionBranchMessage } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  FULL_APP_BUILDING_ENABLED,
  readFusionApp,
} from "../shared/full-app.js";

export default defineAction({
  description:
    "Send a freeform natural-language prompt directly to a fusion (full-app) " +
    "design's in-container coding agent. Use this to relay user requests that " +
    "are broader than a single visual tweak (new features, pages, data model " +
    "changes, bug fixes) for designs backed by a running app container. For " +
    "small scoped visual edits on a specific screen/element, prefer " +
    "queue-fusion-edit + apply-fusion-edits instead so edits can be batched.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    prompt: z
      .string()
      .min(1)
      .describe("The message to send to the app's coding agent."),
  }),
  run: async ({ designId, prompt }) => {
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

    const ownerEmail = getRequestUserEmail();
    const result = await sendFusionBranchMessage({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
      prompt,
      userEmail: ownerEmail ?? undefined,
    });

    return {
      sent: result.sent,
      message: result.response,
      error: result.error,
    };
  },
});
