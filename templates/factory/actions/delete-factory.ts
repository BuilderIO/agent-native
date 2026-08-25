import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  factoryComments,
  factoryDefinitions,
  factoryGraphVersions,
  triageConfig,
  triageDecisions,
  triageFeedback,
  triageItems,
  triageRules,
  triageRuns,
} from "../server/db/schema.js";
import {
  DEFAULT_FACTORY_ID,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import { resolveEnabledAutomationsFromSavedConfig } from "../server/lib/factory-automation-plan.js";
import {
  factoryIdSchema,
  readTriageConfigRow,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  ensureFactoryAutomations,
  removeFactoryAutomationResources,
} from "../server/plugins/factory-scheduler-job.js";

export default defineAction({
  description:
    "Permanently delete a user-created Factory and all Factory-owned graph versions, comments, observations, rules, decisions, runs, feedback, audit events, settings, and scheduled automations. The default product-feedback Factory cannot be deleted. Requires the Factory's exact current name as confirmation; provider work already in progress is not cancelled.",
  schema: z.object({
    factoryId: factoryIdSchema,
    confirmName: z.string().trim().min(1).max(120),
  }),
  http: { method: "DELETE" },
  needsApproval: true,
  run: async ({ factoryId, confirmName }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    if (factoryId === DEFAULT_FACTORY_ID) {
      throw new Error("The default Factory cannot be deleted.");
    }

    const factory = await readFactoryDefinition(orgId, factoryId);
    if (!factory) throw new Error("Factory not found.");
    if (confirmName !== factory.name) {
      throw new Error("Factory name confirmation does not match.");
    }

    const config = await readTriageConfigRow(getDb(), orgId, factoryId);
    const enabledNames = resolveEnabledAutomationsFromSavedConfig({
      pollingEnabled: config?.pollingEnabled ?? 0,
      githubPollingEnabled: config?.githubPollingEnabled ?? 0,
      sentryPollingEnabled: config?.sentryPollingEnabled ?? 0,
      slackChannelId: config?.slackChannelId,
      repository: config?.repository,
      sentryOrgSlug: config?.sentryOrgSlug,
      sentryProjectSlug: config?.sentryProjectSlug,
    });

    const db = getDb();
    try {
      // Remove schedules before SQL so no new run can start; restore both if
      // either step fails so a partial cleanup cannot disable a surviving Factory.
      await removeFactoryAutomationResources(orgId, factoryId);
      await db.transaction(async (tx) => {
        const current = (
          await tx
            .select({ name: factoryDefinitions.name })
            .from(factoryDefinitions)
            .where(
              and(
                eq(factoryDefinitions.id, factoryId),
                eq(factoryDefinitions.orgId, orgId),
              ),
            )
            .limit(1)
        )[0];
        if (!current) return;
        if (current.name !== confirmName) {
          throw new Error(
            "Factory changed before deletion. Confirm its current name and try again.",
          );
        }

        await tx
          .delete(factoryDefinitions)
          .where(
            and(
              eq(factoryDefinitions.id, factoryId),
              eq(factoryDefinitions.orgId, orgId),
            ),
          );

        const scopedTables = [
          factoryComments,
          factoryGraphVersions,
          factoryAuditEvents,
          triageFeedback,
          triageDecisions,
          triageRuns,
          triageRules,
          triageItems,
          triageConfig,
        ] as const;
        for (const table of scopedTables) {
          await tx
            .delete(table)
            .where(and(eq(table.orgId, orgId), eq(table.factoryId, factoryId)));
        }
      });
    } catch (error) {
      try {
        await ensureFactoryAutomations(userEmail, orgId, factoryId, {
          enabledNames,
        });
      } catch (repairError) {
        throw new Error(
          `Factory deletion failed and its automations could not be restored. Deletion error: ${
            error instanceof Error ? error.message : String(error)
          }. Restore error: ${
            repairError instanceof Error
              ? repairError.message
              : String(repairError)
          }.`,
        );
      }
      throw error;
    }

    const remaining = await readFactoryDefinition(orgId, factoryId);
    if (remaining) {
      try {
        await ensureFactoryAutomations(userEmail, orgId, factoryId, {
          enabledNames,
        });
      } catch (repairError) {
        throw new Error(
          `Factory still exists and its automations could not be restored. Restore error: ${
            repairError instanceof Error
              ? repairError.message
              : String(repairError)
          }.`,
        );
      }
      throw new Error("Factory deletion could not be verified.");
    }

    return { ok: true, factoryId, name: factory.name };
  },
});
