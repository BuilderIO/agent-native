import { defineAction } from "@agent-native/core";
import { deleteCollabState } from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  ForbiddenError,
  assertAccess,
  currentAccess,
} from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { nowIso, writeEvent } from "../server/plans.js";

const hardDeleteModeSchema = z.enum(["soft", "restore", "hard"]);

export function hardDeletePlanConfirmation(planId: string) {
  return `DELETE ${planId}`;
}

function requireDeleteOwnerEmail() {
  const requesterEmail = getRequestUserEmail();
  const deleteOwnerEmail = !isAnonymousPublicViewer(requesterEmail)
    ? resolvePlanOwnerEmailForWrite(requesterEmail)
    : requesterEmail;

  if (isAnonymousPublicViewer(requesterEmail)) {
    throw new ForbiddenError(
      "Deleting a plan requires an agent-native account. Sign in to delete.",
    );
  }
  if (isGuestAuthorIdentity(requesterEmail)) {
    throw new ForbiddenError(
      "Deleting a plan requires an account. Sign in to delete.",
    );
  }
  if (!deleteOwnerEmail) {
    throw new ForbiddenError(
      "Deleting a plan requires an agent-native account. Sign in to delete.",
    );
  }
  return deleteOwnerEmail;
}

async function assertPlanOwner(planId: string) {
  const access = await assertAccess(
    "plan",
    planId,
    "owner",
    resolvePlanAccessContext(currentAccess()),
  );
  return access.resource as typeof schema.plans.$inferSelect;
}

function collabPrefixPattern(planId: string) {
  return `${`plan:${planId}:`.replace(/[!%_]/g, (value) => `!${value}`)}%`;
}

function isMissingCollabTableError(error: unknown) {
  return /no such table|does not exist/i.test(String(error));
}

async function deletePlanCollabState(planId: string) {
  await deleteCollabState(`plan:${planId}`);
  try {
    await getDbExec().execute({
      sql: `DELETE FROM _collab_docs WHERE doc_id LIKE ? ESCAPE '!'`,
      args: [collabPrefixPattern(planId)],
    });
  } catch (error) {
    if (!isMissingCollabTableError(error)) throw error;
  }
}

type HardDeleteCounts = {
  comments: number;
  sections: number;
  events: number;
  reports: number;
  versions: number;
  shares: number;
  assets: number;
  plans: number;
};

async function countPlanRows(
  planId: string,
  ownerEmail: string,
): Promise<HardDeleteCounts> {
  const db = getDb();
  const [comments, sections, events, reports, versions, shares, assets, plans] =
    await Promise.all([
      db
        .select({ id: schema.planComments.id })
        .from(schema.planComments)
        .where(eq(schema.planComments.planId, planId)),
      db
        .select({ id: schema.planSections.id })
        .from(schema.planSections)
        .where(eq(schema.planSections.planId, planId)),
      db
        .select({ id: schema.planEvents.id })
        .from(schema.planEvents)
        .where(eq(schema.planEvents.planId, planId)),
      db
        .select({ id: schema.planReports.id })
        .from(schema.planReports)
        .where(eq(schema.planReports.planId, planId)),
      db
        .select({ id: schema.planVersions.id })
        .from(schema.planVersions)
        .where(eq(schema.planVersions.planId, planId)),
      db
        .select({ id: schema.planShares.id })
        .from(schema.planShares)
        .where(eq(schema.planShares.resourceId, planId)),
      db
        .select({ id: schema.planAssets.id })
        .from(schema.planAssets)
        .where(eq(schema.planAssets.planId, planId)),
      db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(
          and(
            eq(schema.plans.id, planId),
            eq(schema.plans.ownerEmail, ownerEmail),
          ),
        ),
    ]);
  return {
    comments: comments.length,
    sections: sections.length,
    events: events.length,
    reports: reports.length,
    versions: versions.length,
    shares: shares.length,
    assets: assets.length,
    plans: plans.length,
  };
}

async function hardDeletePlanRows(planId: string, ownerEmail: string) {
  const db = getDb();
  await db
    .delete(schema.planComments)
    .where(eq(schema.planComments.planId, planId));
  await db
    .delete(schema.planSections)
    .where(eq(schema.planSections.planId, planId));
  await db
    .delete(schema.planEvents)
    .where(eq(schema.planEvents.planId, planId));
  await db
    .delete(schema.planReports)
    .where(eq(schema.planReports.planId, planId));
  await db
    .delete(schema.planVersions)
    .where(eq(schema.planVersions.planId, planId));
  await db
    .delete(schema.planShares)
    .where(eq(schema.planShares.resourceId, planId));
  await db
    .delete(schema.planAssets)
    .where(eq(schema.planAssets.planId, planId));
  await db
    .delete(schema.plans)
    .where(
      and(eq(schema.plans.id, planId), eq(schema.plans.ownerEmail, ownerEmail)),
    );
  await deletePlanCollabState(planId);
}

export default defineAction({
  description:
    "Delete or restore an Agent-Native Plan that you own. Use mode soft to move the plan to Deleted, mode restore to bring a soft-deleted plan back, and mode hard only after the user explicitly confirms permanent deletion by typing the required phrase.",
  schema: z.object({
    planId: z.string().describe("Plan or recap ID to delete or restore."),
    mode: hardDeleteModeSchema
      .optional()
      .default("soft")
      .describe("soft moves to Deleted, restore undeletes, hard is permanent."),
    confirmation: z
      .string()
      .optional()
      .describe(
        "Required for hard delete. Must exactly match `DELETE <planId>`.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Delete Visual Plan",
    description:
      "Soft-delete, restore, or permanently delete a plan or recap you own.",
  },
  needsApproval: (args) => args.mode === "hard",
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const deleteOwnerEmail = requireDeleteOwnerEmail();
    const plan = await assertPlanOwner(args.planId);
    const now = nowIso();

    if (args.mode === "restore") {
      await getDb()
        .update(schema.plans)
        .set({
          deletedAt: null,
          deletedBy: null,
          updatedAt: now,
        })
        .where(eq(schema.plans.id, args.planId));

      await writeEvent({
        planId: args.planId,
        type: "plan.updated",
        message: `Restored ${plan.kind === "recap" ? "recap" : "plan"} ${args.planId}.`,
        payload: { restoredAt: now },
        createdBy: "human",
      });

      return {
        planId: args.planId,
        mode: "restore" as const,
        restoredAt: now,
        hardDeleted: false,
      };
    }

    if (args.mode === "hard") {
      const required = hardDeletePlanConfirmation(args.planId);
      if (args.confirmation?.trim() !== required) {
        throw new Error(
          `Permanent deletion requires typing exactly: ${required}`,
        );
      }

      const deletedCounts = await countPlanRows(args.planId, plan.ownerEmail);
      await hardDeletePlanRows(args.planId, plan.ownerEmail);

      return {
        planId: args.planId,
        mode: "hard" as const,
        deletedAt: now,
        hardDeleted: true,
        deletedCounts,
      };
    }

    const [updated] = await getDb()
      .update(schema.plans)
      .set({
        deletedAt: plan.deletedAt ?? now,
        deletedBy: plan.deletedBy ?? deleteOwnerEmail,
        updatedAt: now,
        visibility: "private",
      })
      .where(
        and(eq(schema.plans.id, args.planId), isNull(schema.plans.deletedAt)),
      )
      .returning({ id: schema.plans.id });

    if (updated) {
      await writeEvent({
        planId: args.planId,
        type: "plan.updated",
        message: `Deleted ${plan.kind === "recap" ? "recap" : "plan"} ${args.planId}.`,
        payload: { deletedAt: now, softDelete: true },
        createdBy: "human",
      });
    }

    return {
      planId: args.planId,
      mode: "soft" as const,
      deletedAt: plan.deletedAt ?? now,
      hardDeleted: false,
    };
  },
});
