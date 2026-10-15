import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  currentRequestUserIsOrgAdmin,
  getAppConfig,
} from "@agent-native/core/server";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import { isHumanCaller, trackDesign } from "../server/lib/design-tracking.js";
import "../server/db/index.js";
import getDesignSystem from "./get-design-system.js";
import { getDesignSchema } from "./get-design.schema.js";

const DESIGN_VIEW_TRACK_WINDOW_MS = 30 * 60 * 1000;
const DESIGN_VIEW_TRACK_MAX_KEYS = 5000;
const lastDesignViewTrackedAt = new Map<string, number>();

const ANALYTICS_ANONYMOUS_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Mirrors core's `readAnalyticsAnonymousId` (server/attribution.ts), which no
// public `@agent-native/core` entry point re-exports yet. Swap to the core
// export once it ships so the cookie contract has one reader.
function readAnonymousId(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== "an_aid") continue;
    const value = part.slice(eq + 1).trim();
    return ANALYTICS_ANONYMOUS_ID_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}

function shouldTrackDesignView(viewerKey: string, designId: string): boolean {
  const key = `${viewerKey}\u0000${designId}`;
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

function trackDesignView(
  ctx: ActionRunContext,
  designId: string,
  role: string,
  visibility: unknown,
): void {
  try {
    const userEmail = ctx.userEmail;
    const anonymousId = userEmail
      ? undefined
      : readAnonymousId(ctx.requestHeaders?.get("cookie"));
    // Viewers with no identity share one key per design: without it every
    // editor poll would record a fresh view, and these rows cannot be
    // attributed to a person anyway.
    const viewerKey = userEmail
      ? `user:${userEmail}`
      : anonymousId
        ? `anon:${anonymousId}`
        : "anon:none";
    if (!shouldTrackDesignView(viewerKey, designId)) return;
    trackDesign(
      "design_viewed",
      {
        caller: ctx.caller,
        output_id: designId,
        output_type: "design",
        is_owner: role === "owner",
        access_role: role,
        viewer_signed_in: Boolean(userEmail),
        visibility,
      },
      userEmail ? ctx : anonymousId ? { anonymousId } : undefined,
    );
  } catch {
    // coercion-ok: a view event is best-effort and must never fail the read.
  }
}

export default defineAction({
  description:
    "Get a design project by ID. Returns the full design data and linked `designSystem.agentContext` when readable. By default, returns all associated files; pass `includeFileContent=false` for file metadata only, then pass a `fileId` to read just one file. Treat design-system context as authoritative before authoring or restyling.",
  schema: getDesignSchema,
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: { method: "GET" },
  run: async (
    { id, fileId, includeFileContent, reviewPreview, reviewOrgId },
    ctx,
  ) => {
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
      const isSuperOrgAdmin = getAppConfig().observability.superOrgId === orgId;
      const targetOrgId = isSuperOrgAdmin ? reviewOrgId : orgId;
      if (!targetOrgId) {
        fail("A customer organization is required for this design preview.", {
          statusCode: 400,
        });
      }
      const [scope] = await db
        .select({
          ownerEmail: schema.designs.ownerEmail,
          orgId: schema.designs.orgId,
        })
        .from(schema.designs)
        .where(
          and(eq(schema.designs.id, id), eq(schema.designs.orgId, targetOrgId)),
        )
        .limit(1);
      if (!scope) fail("Design not found.", { statusCode: 404 });
      const directAccess =
        targetOrgId === orgId ? await resolveAccess("design", id) : null;
      if (directAccess?.resource.orgId === targetOrgId) {
        access = directAccess;
      } else {
        const scopedAccess = await resolveAccess("design", id, {
          userEmail: scope.ownerEmail,
          orgId: targetOrgId,
        });
        if (!scopedAccess || scopedAccess.resource.orgId !== targetOrgId) {
          fail("Design not found.", { statusCode: 404 });
        }
        access = { role: "viewer" as const, resource: scopedAccess.resource };
      }
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

    if (ctx && !reviewPreview && isHumanCaller(ctx)) {
      trackDesignView(ctx, id, access.role, row.visibility);
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
      files: files.map((f) => {
        const metadata = {
          id: f.id,
          filename: f.filename,
          fileType: f.fileType,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        };
        if (includeFileContent === false) return metadata;
        if (!("content" in f)) {
          throw new Error("File content was requested but not selected");
        }
        return { ...metadata, content: f.content };
      }),
    };
  },
});
