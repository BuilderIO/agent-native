import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import "../server/db/index.js";

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
    "oldest first. Optionally filter by status (pending|sent|unconfirmed|error). Use to " +
    "review what's queued before calling apply-builder-edits, or to check the " +
    "outcome of a previous batch.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    status: z
      .enum(["pending", "sent", "unconfirmed", "error"])
      .optional()
      .describe("Filter to edits with this status. Omit to return all."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, status }, ctx) => {
    if (!(await isFullAppBuildingEnabled(ctx))) {
      throw new Error("Full app building is not enabled");
    }

    await assertAccess("design", designId, "editor");

    const db = getDb();
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
    // Sent, but Builder never confirmed the run finished; held until the user
    // checks the app and retries (apply-builder-edits retryUnconfirmed).
    const unconfirmedCount = rows.filter(
      (row) => row.status === "unconfirmed",
    ).length;

    return { edits, pendingCount, unconfirmedCount };
  },
});
