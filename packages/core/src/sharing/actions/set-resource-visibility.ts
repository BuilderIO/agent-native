import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "../../action.js";
import {
  assertAccess,
  currentAccess,
  ForbiddenError,
  resolveRegisteredAccessContext,
} from "../access.js";
import { requireShareableResource } from "../registry.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

export default defineAction({
  description:
    "Change the coarse visibility of a shareable resource: 'private' keeps it owner-only, 'org' shares it with all members of the owner's organization, 'public' makes it accessible to anyone with the link. Owner or admin role required.",
  // (audit H5) Visibility changes are admin-tier and can flip a private
  // resource org-wide or public. Refuse from the tools iframe bridge.
  toolCallable: false,
  mcpApp: {
    compactCatalog: true,
  },
  schema: z.object({
    resourceType: z.string(),
    resourceId: z.string(),
    visibility: z.enum(["private", "org", "public"]),
  }),
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
    const beforeExtensionTargets = await getExtensionShareChangeTargets(
      args.resourceType,
      args.resourceId,
    );
    const db = reg.getDb() as any;
    const update: Record<string, unknown> = { visibility: args.visibility };
    const currentOrgId = resolveRegisteredAccessContext(
      reg,
      currentAccess(),
    ).orgId;
    // Only the resource owner may bind an org to a previously unscoped resource.
    // If a non-owner admin did this, the resource would adopt the admin's org
    // and ownerMatchesActiveScope would then lock the real owner out of their
    // own resource. Non-owner admins can still flip visibility once orgId is set.
    if (
      args.visibility === "org" &&
      currentOrgId &&
      !access.resource?.orgId &&
      access.role === "owner"
    ) {
      update.orgId = currentOrgId;
    }
    await db
      .update(reg.resourceTable)
      .set(update)
      .where(eq(reg.resourceTable.id, args.resourceId));
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );
    return { ok: true, visibility: args.visibility };
  },
});
