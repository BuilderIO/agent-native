import { defineAction, fail } from "@agent-native/core/action";
import { currentRequestUserIsOrgAdmin } from "@agent-native/core/server";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
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
    reviewPreview: z
      .boolean()
      .optional()
      .describe(
        "Human Review only: read a design in the current organization. Requires an organization owner or admin.",
      ),
  }),
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ id, fileId, includeFileContent, reviewPreview }, ctx) => {
    const db = getDb();
    let access;
    if (reviewPreview) {
      const orgId = getRequestOrgId();
      if (!orgId || !(await currentRequestUserIsOrgAdmin(orgId))) {
        fail(
          "Only organization owners and admins can preview reviewed designs.",
          { statusCode: 403 },
        );
      }
      const [resource] = await db
        .select()
        .from(schema.designs)
        .where(and(eq(schema.designs.id, id), eq(schema.designs.orgId, orgId)))
        .limit(1);
      if (!resource) fail("Design not found.", { statusCode: 404 });
      access = { role: "viewer" as const, resource };
    } else {
      access = await resolveAccess("design", id);
    }
    if (!access) {
      const error = new Error("Design not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    const row = access.resource;
    // Fetch associated files in a stable order. This array feeds the overview
    // canvas's screen stack and each screen's index within its layout group, so
    // unordered rows (Postgres returns heap order, which an UPDATE can change)
    // meant the same design could lay itself out differently on two loads.
    // Note this is deterministic, not creation-ordered: files written in one
    // batch share a `createdAt` to the millisecond and fall back to the id
    // tiebreak. Nothing may depend on the index matching the order a generator
    // wrote in — see the order-independence case in variant-lineup.test.ts.
    const baseFileFields = {
      id: schema.designFiles.id,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      createdAt: schema.designFiles.createdAt,
      updatedAt: schema.designFiles.updatedAt,
    };
    const fileFilter = fileId
      ? and(
          eq(schema.designFiles.designId, id),
          eq(schema.designFiles.id, fileId),
        )
      : eq(schema.designFiles.designId, id);
    const fileOrder = [
      asc(schema.designFiles.createdAt),
      asc(schema.designFiles.id),
    ] as const;
    const files =
      includeFileContent === false
        ? await db
            .select(baseFileFields)
            .from(schema.designFiles)
            .where(fileFilter)
            .orderBy(...fileOrder)
        : await db
            .select({ ...baseFileFields, content: schema.designFiles.content })
            .from(schema.designFiles)
            .where(fileFilter)
            .orderBy(...fileOrder);
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
        ...(includeFileContent === false || !("content" in f)
          ? {}
          : { content: f.content }),
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    };
  },
});
