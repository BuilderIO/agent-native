/**
 * queue-fusion-edit — queue a visual edit instruction for a fusion (full-app)
 * design.
 *
 * Fusion screens are iframes of a real running app, so edits cannot be
 * applied synchronously to local HTML the way inline designs are. Instead the
 * instruction is queued as a pending `design_fusion_edits` row; call
 * `apply-fusion-edits` to batch pending rows into one prompt for the
 * in-container app agent.
 */

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { FULL_APP_BUILDING_ENABLED } from "../shared/full-app.js";

const targetSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe("CSS selector or data-node id of the element pointed at."),
  path: z
    .string()
    .optional()
    .describe("Route path of the screen, e.g. '/settings'."),
  url: z.string().optional().describe("Full screen URL at edit time."),
  nodeName: z
    .string()
    .optional()
    .describe("Human-readable element description, e.g. 'primary button'."),
});

export default defineAction({
  description:
    "Queue a natural-language visual edit instruction for a fusion (full-app) " +
    "design. Use this when the user requests a change to a screen backed by a " +
    "running app container (sourceType 'fusion') — the edit cannot be applied " +
    "synchronously like inline HTML, so it queues as a pending row. Call " +
    "apply-fusion-edits to dispatch all pending edits to the in-container app " +
    "agent in one batch. Pass screenFileId and/or target (selector/path/url/" +
    "nodeName) when the user has a specific screen or element selected so the " +
    "app agent has enough context to locate the change.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    instruction: z
      .string()
      .min(1)
      .describe("Natural-language description of the requested change."),
    screenFileId: z
      .string()
      .optional()
      .describe("design_files.id of the URL-backed screen this edit targets."),
    target: targetSchema
      .optional()
      .describe("Optional target context for the element/screen being edited."),
  }),
  run: async ({ designId, instruction, screenFileId, target }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    await assertAccess("design", designId, "editor");

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    await db.insert(schema.designFusionEdits).values({
      id,
      designId,
      screenFileId: screenFileId ?? null,
      instruction,
      target: target ? JSON.stringify(target) : null,
      status: "pending",
      batchId: null,
      error: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
    });

    const [row] = await db
      .select({ value: count() })
      .from(schema.designFusionEdits)
      .where(
        and(
          eq(schema.designFusionEdits.designId, designId),
          eq(schema.designFusionEdits.ownerEmail, ownerEmail),
          eq(schema.designFusionEdits.status, "pending"),
        ),
      );

    return {
      editId: id,
      pendingCount: row?.value ?? 0,
    };
  },
});
