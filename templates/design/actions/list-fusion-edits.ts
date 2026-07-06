/**
 * list-fusion-edits — read-only list of queued fusion edit instructions for a
 * design.
 *
 * Viewer access is sufficient since this is a read. Returns edits ordered
 * oldest-first (the order apply-fusion-edits will present them to the app
 * agent) plus a pendingCount convenience field.
 */

import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { FULL_APP_BUILDING_ENABLED } from "../shared/full-app.js";

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

export default defineAction({
  description:
    "List queued fusion (full-app) visual edit instructions for a design, " +
    "oldest first. Optionally filter by status (pending|sent|error). Use to " +
    "review what's queued before calling apply-fusion-edits, or to check the " +
    "outcome of a previous batch.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    status: z
      .enum(["pending", "sent", "error"])
      .optional()
      .describe("Filter to edits with this status. Omit to return all."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, status }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const db = getDb();

    const [design] = await db
      .select({ id: schema.designs.id })
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

    const conditions = [eq(schema.designFusionEdits.designId, designId)];
    if (status) conditions.push(eq(schema.designFusionEdits.status, status));

    const rows = await db
      .select()
      .from(schema.designFusionEdits)
      .where(and(...conditions))
      .orderBy(asc(schema.designFusionEdits.createdAt));

    const edits = rows.map((row) => ({
      id: row.id,
      instruction: row.instruction,
      target: parseTarget(row.target),
      status: row.status,
      screenFileId: row.screenFileId,
      batchId: row.batchId,
      error: row.error,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    }));

    const pendingCount = rows.filter((row) => row.status === "pending").length;

    return { edits, pendingCount };
  },
});
