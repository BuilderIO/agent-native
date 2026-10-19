import { defineAction, fail } from "@agent-native/core/action";
import {
  createFusionAgentFeed,
  sendFusionBranchMessage,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import "../server/db/index.js";
import { readFusionApp } from "../shared/full-app.js";

export default defineAction({
  description:
    "Send a freeform natural-language prompt directly to a fusion (full-app) " +
    "design's in-container coding agent. Use this to relay user requests that " +
    "are broader than a single visual tweak (new features, pages, data model " +
    "changes, bug fixes) for designs backed by a running app container. For " +
    "small scoped visual edits on a specific screen/element, prefer " +
    "queue-builder-edit + apply-builder-edits instead so edits can be batched.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    prompt: z
      .string()
      .min(1)
      .describe("The message to send to the app's coding agent."),
    visualEditRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "When this applies a pending visual-edit handoff, its revision from get-visual-edit-pending. It is cleared only if Builder finishes without an error.",
      ),
  }),
  run: async ({ designId, prompt, visualEditRevision }, ctx) => {
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

    const ownerEmail = getRequestUserEmail();
    // Delegate to the Builder coding agent as a sub-agent: its reasoning,
    // tools and file edits stream into this chat as they happen, and the
    // turn ends when the Builder agent is done (not when it was dispatched).
    const feed = createFusionAgentFeed({
      send: ctx?.send,
      agent: "Builder",
      agentCallId: `fusion-${nanoid(10)}`,
    });
    const result = await sendFusionBranchMessage({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
      prompt,
      userEmail: ownerEmail ?? undefined,
      fireAndForget: false,
      timeoutMs: 15 * 60_000,
      onEvent: feed.onEvent,
    });
    const summary = feed.finish(result);

    // A full-app design's visual edits are applied here, by Builder, so
    // this is where their handoff is settled: the acknowledge action
    // is for external coding agents and is not an agent tool.
    const visualEditHandoff =
      visualEditRevision !== undefined && result.sent && !result.error
        ? await settleVisualEditHandoff(designId, visualEditRevision)
        : undefined;

    return {
      sent: result.sent,
      visualEditHandoff,
      message: summary.text ?? result.response,
      changedFiles: summary.changedFiles,
      creditsUsed: summary.creditsUsed,
      error: result.error,
      next:
        summary.changedFiles.length > 0
          ? "The app's screens reload from the live container; check them before replying."
          : undefined,
    };
  },
});

async function settleVisualEditHandoff(
  designId: string,
  revision: number,
): Promise<"cleared" | "stale"> {
  const updated = await getDb()
    .update(schema.designVisualEditPending)
    .set({
      pendingEditCount: 0,
      status: "empty",
      prompt: "",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.designVisualEditPending.designId, designId),
        eq(schema.designVisualEditPending.revision, revision),
      ),
    )
    .returning({ designId: schema.designVisualEditPending.designId });
  return updated.length > 0 ? "cleared" : "stale";
}
