import { defineAction } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import {
  assertAccess,
  resolveAccess,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DESIGN_SYSTEM_MANAGE_ROLE } from "../server/lib/design-system-access.js";

type EffectiveRole = "owner" | ShareRole;

function canEditDesignRole(role: EffectiveRole) {
  return ROLE_RANK[role] >= ROLE_RANK.editor;
}

function canManageTemplateRole(role: EffectiveRole) {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}

type UnlinkResult = { id: string; status: "unlinked" | "skipped-no-access" };

// Admin access on a shared design system does not grant write access to
// every design or saved template that happens to reference it — those are
// separate resources with their own owners and shares. Skip anything the
// caller can't edit instead of silently rewriting it, and report the skips
// back so the caller can decide whether to follow up.
async function unlinkDesign(designId: string): Promise<UnlinkResult> {
  const access = await resolveAccess("design", designId);
  if (!access || !canEditDesignRole(access.role)) {
    return { id: designId, status: "skipped-no-access" };
  }
  await getDb()
    .update(schema.designs)
    .set({ designSystemId: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.designs.id, designId));
  return { id: designId, status: "unlinked" };
}

async function unlinkDesignTemplate(templateId: string): Promise<UnlinkResult> {
  const access = await resolveAccess("design-template", templateId);
  if (!access || !canManageTemplateRole(access.role)) {
    return { id: templateId, status: "skipped-no-access" };
  }
  await getDb()
    .update(schema.designTemplates)
    .set({ designSystemId: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.designTemplates.id, templateId));
  return { id: templateId, status: "unlinked" };
}

export default defineAction({
  description:
    "Delete a design system. Requires admin access or higher. Designs and " +
    "saved templates linked to it that the caller can edit are unlinked; " +
    "others keep a dangling reference. If the deleted system was the " +
    "owner's default, another of their design systems is promoted to " +
    "default.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID to delete"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess(
      "design-system",
      id,
      DESIGN_SYSTEM_MANAGE_ROLE,
    );

    const db = getDb();
    const orgId = getRequestOrgId();

    const [linkedDesignIds, linkedTemplateIds] = await Promise.all([
      db
        .select({ id: schema.designs.id })
        .from(schema.designs)
        .where(eq(schema.designs.designSystemId, id))
        .then((rows) => rows.map((row) => row.id)),
      db
        .select({ id: schema.designTemplates.id })
        .from(schema.designTemplates)
        .where(eq(schema.designTemplates.designSystemId, id))
        .then((rows) => rows.map((row) => row.id)),
    ]);

    // Delete the design system (and its shares) before touching linked
    // designs/templates. Once the row is gone, other actions'
    // assertAccess("design-system", ...) checks fail for anyone trying to
    // attach a fresh link, shrinking the window for a new link to attach to
    // a design system being deleted.
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.designSystemShares)
        .where(eq(schema.designSystemShares.resourceId, id));

      await tx
        .delete(schema.designSystems)
        .where(eq(schema.designSystems.id, id));

      if (access.resource.isDefault) {
        const ownerScope = orgId
          ? and(
              eq(schema.designSystems.ownerEmail, access.resource.ownerEmail),
              eq(schema.designSystems.orgId, orgId),
            )
          : and(
              eq(schema.designSystems.ownerEmail, access.resource.ownerEmail),
              isNull(schema.designSystems.orgId),
            );
        const [next] = await tx
          .select({ id: schema.designSystems.id })
          .from(schema.designSystems)
          .where(ownerScope)
          .orderBy(desc(schema.designSystems.updatedAt))
          .limit(1);
        if (next) {
          await tx
            .update(schema.designSystems)
            .set({ isDefault: true, updatedAt: new Date().toISOString() })
            .where(eq(schema.designSystems.id, next.id));
        }
      }
    });

    // Best-effort cleanup: the design system is already gone, so a design or
    // template we can't touch (missing access) is left dangling rather than
    // retried here — both get-design-template and list-design-templates
    // already mask a dangling designSystemId by resolving it back to null.
    const [designResults, templateResults] = await Promise.all([
      Promise.allSettled(linkedDesignIds.map(unlinkDesign)),
      Promise.allSettled(linkedTemplateIds.map(unlinkDesignTemplate)),
    ]);

    const designsSkippedForAccess = linkedDesignIds.filter(
      (_, index) =>
        designResults[index].status === "fulfilled" &&
        (designResults[index] as PromiseFulfilledResult<UnlinkResult>).value
          .status === "skipped-no-access",
    );
    const templatesSkippedForAccess = linkedTemplateIds.filter(
      (_, index) =>
        templateResults[index].status === "fulfilled" &&
        (templateResults[index] as PromiseFulfilledResult<UnlinkResult>).value
          .status === "skipped-no-access",
    );

    return {
      id,
      deleted: true,
      ...(designsSkippedForAccess.length > 0
        ? { designsSkippedForAccess }
        : {}),
      ...(templatesSkippedForAccess.length > 0
        ? { templatesSkippedForAccess }
        : {}),
    };
  },
});
