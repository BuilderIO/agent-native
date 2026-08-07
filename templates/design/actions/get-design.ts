import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Get a design project by ID. Returns the full design data including all associated files.",
  schema: z.object({
    id: z.string().describe("Design ID"),
  }),
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design", id);
    if (!access) {
      const error = new Error("Design not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const row = access.resource;
    const db = getDb();

    // Fetch associated files in a stable order. This array feeds the overview
    // canvas's screen stack and each screen's index within its layout group, so
    // unordered rows (Postgres returns heap order, which an UPDATE can change)
    // meant the same design could lay itself out differently on two loads.
    // Note this is deterministic, not creation-ordered: files written in one
    // batch share a `createdAt` to the millisecond and fall back to the id
    // tiebreak. Nothing may depend on the index matching the order a generator
    // wrote in — see the order-independence case in variant-lineup.test.ts.
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id))
      .orderBy(asc(schema.designFiles.createdAt), asc(schema.designFiles.id));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      projectType: row.projectType,
      designSystemId: row.designSystemId,
      data: designDataForAccessRole(row.data ?? null, access.role),
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessRole: access.role,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    };
  },
});
