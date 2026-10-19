import { defineAction, fail } from "@agent-native/core/action";
import {
  createFusionAgentFeed,
  sendFusionBranchMessage,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import "../server/db/index.js";
import { readFusionApp } from "../shared/full-app.js";

function parseTarget(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatTargetContext(target: Record<string, unknown> | null): string {
  if (!target) return "";
  const parts: string[] = [];
  if (typeof target.path === "string" && target.path) {
    parts.push(`path: ${target.path}`);
  }
  if (typeof target.selector === "string" && target.selector) {
    parts.push(`selector: ${target.selector}`);
  }
  if (typeof target.nodeName === "string" && target.nodeName) {
    parts.push(`element: ${target.nodeName}`);
  }
  if (typeof target.url === "string" && target.url) {
    parts.push(`url: ${target.url}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "Send all (or the given) pending queued fusion edits to the app's " +
    "in-container coding agent in a single batched prompt. Use after " +
    "queue-builder-edit has accumulated one or more edits the user wants " +
    "applied now. Marks them sent with a shared batchId once Builder " +
    "finishes. If the send fails they stay pending. If Builder never confirms " +
    "the run finished (timed out), they are held as unconfirmed, since Builder " +
    "may still be applying them: check the app, and only if the edits did not " +
    "land, call again with retryUnconfirmed: true. Returns sentCount=0 with a " +
    "message if there were no pending edits to send.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    editIds: z
      .array(z.string())
      .optional()
      .describe(
        "Specific design_fusion_edits ids to apply (must still be pending). " +
          "Omit to apply all pending edits for this design.",
      ),
    retryUnconfirmed: z
      .boolean()
      .optional()
      .describe(
        "Requeue edits held as unconfirmed and send them again. Only after " +
          "checking the app shows they did not land.",
      ),
  }),
  run: async ({ designId, editIds, retryUnconfirmed }, ctx) => {
    if (!(await isFullAppBuildingEnabled(ctx))) {
      fail("Full app building is not enabled", {
        errorCode: "full_app_building_disabled",
      });
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const fusionApp = readFusionApp(design.data);
    if (!fusionApp) {
      fail("This design has no Builder app. Call create-builder-app first.", {
        errorCode: "fusion_app_linkage_required",
      });
    }

    const db = getDb();
    if (retryUnconfirmed) {
      await db
        .update(schema.designFusionEdits)
        .set({ status: "pending", updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(schema.designFusionEdits.designId, designId),
            eq(schema.designFusionEdits.status, "unconfirmed"),
          ),
        );
    }
    const conditions = [
      eq(schema.designFusionEdits.designId, designId),
      eq(schema.designFusionEdits.status, "pending"),
    ];
    if (editIds && editIds.length > 0) {
      conditions.push(inArray(schema.designFusionEdits.id, editIds));
    }

    const pending = await db
      .select()
      .from(schema.designFusionEdits)
      .where(and(...conditions))
      .orderBy(schema.designFusionEdits.createdAt);

    if (pending.length === 0) {
      return {
        sentCount: 0,
        message: "No queued Builder edits to apply.",
      };
    }

    const lines = pending.map((edit, index) => {
      const target = formatTargetContext(parseTarget(edit.target));
      return `${index + 1}. ${edit.instruction}${target}`;
    });
    const prompt = [
      "Apply the following queued visual edits to the app; keep changes minimal and scoped:",
      "",
      ...lines,
    ].join("\n");

    const ownerEmail = getRequestUserEmail();
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

    const now = new Date().toISOString();
    const ids = pending.map((edit) => edit.id);

    // Only a run Builder finished applied the edits. A run that may still be
    // going (dispatched, then timed out or cut off) is held as unconfirmed so
    // a second apply cannot send the same edits again while it runs. A run
    // that never went out, or ended with an error, has stopped: those edits
    // go back to the queue with the reason.
    if (!result.completed) {
      const unconfirmed = result.unconfirmed === true;
      const reason =
        result.error ??
        (result.sent
          ? "Builder did not finish applying these edits"
          : "Send failed");
      await db
        .update(schema.designFusionEdits)
        .set(
          unconfirmed
            ? {
                status: "unconfirmed",
                batchId: nanoid(),
                sentAt: now,
                error: reason,
                updatedAt: now,
              }
            : { status: "pending", error: reason, updatedAt: now },
        )
        .where(inArray(schema.designFusionEdits.id, ids));
      fail(
        unconfirmed
          ? `${reason}. Builder may still be applying these edits: check the app, and only if they did not land, call apply-builder-edits again with retryUnconfirmed: true.`
          : reason,
        {
          errorCode: unconfirmed
            ? "fusion_edit_unconfirmed"
            : "fusion_edit_dispatch_failed",
          statusCode: unconfirmed ? 504 : 502,
        },
      );
    }

    const batchId = nanoid();
    await db
      .update(schema.designFusionEdits)
      .set({
        status: "sent",
        batchId,
        sentAt: now,
        error: null,
        updatedAt: now,
      })
      .where(inArray(schema.designFusionEdits.id, ids));

    return {
      sentCount: pending.length,
      batchId,
      changedFiles: summary.changedFiles,
      message:
        summary.changedFiles.length > 0
          ? `Builder applied ${pending.length} edit(s) and changed ${summary.changedFiles.length} file(s); the app's screens show the result now.`
          : `Builder finished batch "${batchId}" without changing files.`,
      agentReply: summary.text,
    };
  },
});
