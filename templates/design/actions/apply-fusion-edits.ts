/**
 * apply-fusion-edits — batch pending queued edits into one prompt and send it
 * to the fusion app's in-container coding agent.
 *
 * Composes a single message from all pending edits (or a caller-specified
 * subset, still pending) so the app agent gets full context in one turn
 * instead of being spammed with one message per edit. Marks rows `sent` (with
 * a shared `batchId`) on success, or `error` (with the failure message) on
 * failure — so `list-fusion-edits` reflects the outcome without another call.
 */

import { defineAction } from "@agent-native/core";
import { sendFusionBranchMessage } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  FULL_APP_BUILDING_ENABLED,
  readFusionApp,
} from "../shared/full-app.js";

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
  description:
    "Send all (or the given) pending queued fusion edits to the app's " +
    "in-container coding agent in a single batched prompt. Use after " +
    "queue-fusion-edit has accumulated one or more edits the user wants " +
    "applied now. Marks sent edits with a shared batchId, or marks them " +
    "'error' if the send failed. Returns sentCount=0 with a message if there " +
    "were no pending edits to send.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    editIds: z
      .array(z.string())
      .optional()
      .describe(
        "Specific design_fusion_edits ids to apply (must still be pending). " +
          "Omit to apply all pending edits for this design.",
      ),
  }),
  run: async ({ designId, editIds }) => {
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

    const db = getDb();
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
        message: "No pending fusion edits to apply.",
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
    const result = await sendFusionBranchMessage({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
      prompt,
      userEmail: ownerEmail ?? undefined,
    });

    const now = new Date().toISOString();
    const ids = pending.map((edit) => edit.id);

    if (!result.sent) {
      await db
        .update(schema.designFusionEdits)
        .set({
          status: "error",
          error: result.error ?? "Send failed",
          updatedAt: now,
        })
        .where(inArray(schema.designFusionEdits.id, ids));
      return {
        sentCount: 0,
        error: result.error ?? "Failed to send edits to the app agent",
      };
    }

    const batchId = nanoid();
    await db
      .update(schema.designFusionEdits)
      .set({ status: "sent", batchId, sentAt: now, updatedAt: now })
      .where(inArray(schema.designFusionEdits.id, ids));

    return {
      sentCount: pending.length,
      batchId,
      message:
        `Sent ${pending.length} queued edit(s) to the app agent as batch ` +
        `"${batchId}".`,
    };
  },
});
