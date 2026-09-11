import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertVersionedResourceAccess,
  getVersionedResource,
  normalizeHistoryVisibility,
} from "../registry.js";
import { insertResourceVersion } from "../store.js";
import type { HistoryActorKind, VersionedResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  title: z.string().optional(),
  summary: z.string().optional(),
  snapshot: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default defineAction({
  description: "Create a reusable version-history snapshot for a resource.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as VersionedResourceContext | undefined;
    const access = await assertVersionedResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    const registration = getVersionedResource(args.resourceType);
    // Prefer the registered server snapshot when available so editors/agents
    // cannot plant arbitrary restore payloads for managed resource types.
    const serverSnapshot = registration?.getSnapshot
      ? await registration.getSnapshot({
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          ctx: actionCtx,
          access,
        })
      : undefined;
    const snapshot =
      serverSnapshot !== undefined ? serverSnapshot : args.snapshot;

    if (snapshot === undefined) {
      throw new Error(
        `No snapshot was provided and ${args.resourceType} has no getSnapshot history handler`,
      );
    }

    return insertResourceVersion({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      createdBy: actionCtx?.userEmail ?? null,
      actorKind: actorKindFromContext(actionCtx),
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: normalizeHistoryVisibility(access.visibility),
      title: args.title,
      summary: args.summary,
      snapshot,
      metadata: args.metadata,
    });
  },
  audit: {
    target: (args, result) => {
      const version = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: version.ownerEmail,
        orgId: version.orgId,
        visibility: version.visibility,
      };
    },
  },
});

function actorKindFromContext(
  ctx: VersionedResourceContext | undefined,
): HistoryActorKind {
  const caller = typeof ctx?.caller === "string" ? ctx.caller : "";
  if (caller === "agent" || caller === "tool") {
    return "agent";
  }
  return ctx?.userEmail ? "human" : "system";
}
