import { defineAction } from "@agent-native/core/action";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import getDesignSystem from "./get-design-system.js";

// The editor re-reads get-design after saves, on sync events, and every second
// while a generation runs. Count a signed-in viewer's view once per window,
// not once per read. Per server instance; anonymous reads have no viewer key.
const DESIGN_VIEW_TRACK_WINDOW_MS = 30 * 60 * 1000;
const DESIGN_VIEW_TRACK_MAX_KEYS = 5000;
const lastDesignViewTrackedAt = new Map<string, number>();

function shouldTrackDesignView(
  viewer: string | undefined,
  designId: string,
): boolean {
  if (!viewer) return true;
  const key = `${viewer}\u0000${designId}`;
  const now = Date.now();
  const last = lastDesignViewTrackedAt.get(key);
  if (last !== undefined && now - last < DESIGN_VIEW_TRACK_WINDOW_MS) {
    return false;
  }
  lastDesignViewTrackedAt.delete(key);
  lastDesignViewTrackedAt.set(key, now);
  if (lastDesignViewTrackedAt.size > DESIGN_VIEW_TRACK_MAX_KEYS) {
    const oldest = lastDesignViewTrackedAt.keys().next();
    if (!oldest.done) lastDesignViewTrackedAt.delete(oldest.value);
  }
  return true;
}

export default defineAction({
  description:
    "Get a design project by ID. Returns the full design data and linked `designSystem.agentContext` when readable. By default, returns all associated files; pass `includeFileContent=false` for file metadata only, then pass a `fileId` to read just one file. Treat design-system context as authoritative before authoring or restyling.",
  schema: z.object({
    id: z.string().describe("Design ID"),
    fileId: z.string().min(1).optional().describe("Read one design file by ID"),
    includeFileContent: z
      .boolean()
      .optional()
      .describe("Set false to return file metadata without HTML contents"),
  }),
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ id, fileId, includeFileContent }, ctx) => {
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
    const fileWhere = fileId
      ? and(
          eq(schema.designFiles.designId, id),
          eq(schema.designFiles.id, fileId),
        )
      : eq(schema.designFiles.designId, id);
    // Two concrete selects instead of one ternary-built field map: a shared
    // `fileFields` object mixes a `content` column into one branch's rows,
    // which widens db.select()'s inferred argument type into a shape neither
    // branch actually returns.
    const files =
      includeFileContent === false
        ? await db
            .select({
              id: schema.designFiles.id,
              filename: schema.designFiles.filename,
              fileType: schema.designFiles.fileType,
              createdAt: schema.designFiles.createdAt,
              updatedAt: schema.designFiles.updatedAt,
            })
            .from(schema.designFiles)
            .where(fileWhere)
            .orderBy(
              asc(schema.designFiles.createdAt),
              asc(schema.designFiles.id),
            )
        : await db
            .select({
              id: schema.designFiles.id,
              filename: schema.designFiles.filename,
              fileType: schema.designFiles.fileType,
              content: schema.designFiles.content,
              createdAt: schema.designFiles.createdAt,
              updatedAt: schema.designFiles.updatedAt,
            })
            .from(schema.designFiles)
            .where(fileWhere)
            .orderBy(
              asc(schema.designFiles.createdAt),
              asc(schema.designFiles.id),
            );
    const designSystem = await loadAgentDesignSystemContext(
      typeof row.designSystemId === "string" ? row.designSystemId : null,
      getDesignSystem,
    );

    if (shouldTrackDesignView(ctx?.userEmail, id)) {
      track(
        "design_viewed",
        {
          app_name: "design",
          template_name: "design",
          output_id: id,
          output_type: "design",
          is_owner: access.role === "owner",
        },
        ctx,
      );
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      projectType: row.projectType,
      designSystemId: row.designSystemId,
      liveCollaborationEnabled: row.liveCollaborationEnabled === true,
      designSystem,
      data: designDataForAccessRole(row.data ?? null, access.role),
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessRole: access.role,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        fileType: f.fileType,
        // The `includeFileContent === false` branch above never selects
        // `content`, so this cast only fires on rows the other branch
        // fetched with it.
        ...(includeFileContent === false
          ? {}
          : { content: (f as unknown as { content: string }).content }),
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    };
  },
});
