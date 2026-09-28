import { eq } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { track } from "../../tracking/registry.js";
import {
  assertAccess,
  currentAccess,
  ForbiddenError,
  resolveRegisteredAccessContext,
} from "../access.js";
import { requireShareableResource } from "../registry.js";
import { resourceSharingChange } from "./change-result.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

export default defineAction({
  description:
    "Change the coarse visibility of a shareable resource: 'private' keeps it owner-only, 'org' shares it with all members of the owner's organization, 'public' makes it accessible to anyone with the link. Visibility changes require owner or admin role.",
  toolCallable: false,
  mcpApp: {
    compactCatalog: true,
  },
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    visibility: z.enum(["private", "org", "public"]),
  }),
  needsApproval: async (args) => {
    if (args.visibility !== "public") return false;
    const reg = requireShareableResource(args.resourceType);
    if (reg.allowPublic === false) return false;
    const access = await assertAccess(
      args.resourceType,
      args.resourceId,
      "admin",
      undefined,
      { skipResourceBody: true },
    );
    return access.resource.visibility !== "public";
  },
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    if (args.visibility === "public" && reg.allowPublic === false) {
      throw new ForbiddenError(
        `${reg.displayName} cannot be made public — share with specific people or your organization instead.`,
      );
    }
    const access = await assertAccess(
      args.resourceType,
      args.resourceId,
      "admin",
    );
    const visibilityChanged = access.resource?.visibility !== args.visibility;
    const db = reg.getDb() as any;
    const update: Record<string, unknown> = { visibility: args.visibility };
    const rawAccess = currentAccess();
    const currentOrgId = resolveRegisteredAccessContext(reg, rawAccess).orgId;
    if (args.visibility === "org" && !access.resource?.orgId) {
      if (!currentOrgId) {
        const canKeepResourceUnscoped =
          !!rawAccess.orgId &&
          !!reg.resolveAccessContext &&
          access.role === "owner";
        if (!canKeepResourceUnscoped) {
          throw new ForbiddenError(
            `${reg.displayName} cannot be shared with your organization because no active organization is selected.`,
          );
        }
      } else {
        if (access.role !== "owner") {
          throw new ForbiddenError(
            `${reg.displayName} can only be attached to an organization by its owner.`,
          );
        }
        update.orgId = currentOrgId;
      }
    }
    const resourceChanged = visibilityChanged || update.orgId !== undefined;
    const beforeExtensionTargets = await getExtensionShareChangeTargets(
      args.resourceType,
      args.resourceId,
    );
    if (reg.persistVisibilityChange) {
      await reg.persistVisibilityChange({
        resource: access.resource,
        resourceId: args.resourceId,
        visibility: args.visibility,
        update,
        userEmail: rawAccess.userEmail,
        orgId: currentOrgId,
      });
    } else {
      await db
        .update(reg.resourceTable)
        .set(update)
        .where(eq(reg.resourceTable.id, args.resourceId));
    }
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    if (visibilityChanged) {
      const app = getAppConfig().app.slug ?? "unknown";
      track(
        "share_visibility_change",
        {
          app,
          template: app,
          resource_type: args.resourceType,
          resource_id: args.resourceId,
          visibility: args.visibility,
          is_public: args.visibility === "public",
        },
        { userId: rawAccess.userEmail ?? undefined },
      );
    }
    return {
      ok: true,
      visibility: args.visibility,
      ...(resourceChanged
        ? {
            change: resourceSharingChange(
              reg,
              access.resource,
              "updated",
              args.visibility,
            ).change,
          }
        : {}),
    };
  },
});
