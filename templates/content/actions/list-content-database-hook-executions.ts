import { defineAction } from "@agent-native/core";
import {
  notificationDeliveryAttempts,
  workflowEffects,
  workflowExecutions,
  workflowSubscriptionVersions,
} from "@agent-native/core/workflow";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import type { ContentDatabaseHookEffectExecution } from "../shared/api.js";
import {
  contentHookConfigFromJson,
  requireContentDatabaseAccess,
} from "./_content-database-hooks.js";

function parseResult(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function ledgerEffectKind(
  value: string,
): ContentDatabaseHookEffectExecution["kind"] {
  switch (value) {
    case "notify":
    case "notification":
    case "team_slack":
    case "webhook":
    case "set_property":
    case "content_hook_control":
      return value;
    default:
      return "unknown";
  }
}

export default defineAction({
  description:
    "List recent Content Rule runs with action, coalescing, suppression, and delivery-attempt truth from the shared workflow ledger.",
  schema: z.object({
    databaseId: z.string().min(1),
    hookId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  http: { method: "GET" },
  run: async ({ databaseId, hookId, limit }) => {
    const database = await requireContentDatabaseAccess(databaseId, "viewer");
    const db = getDb();
    const candidates = await db
      .select({
        id: workflowExecutions.id,
        hookId: workflowExecutions.subscriptionId,
        subscriptionVersion: workflowExecutions.subscriptionVersion,
        eventId: workflowExecutions.eventId,
        status: workflowExecutions.status,
        attempts: workflowExecutions.attempt,
        error: workflowExecutions.errorMessage,
        createdAt: workflowExecutions.createdAt,
        updatedAt: workflowExecutions.updatedAt,
        config: workflowSubscriptionVersions.config,
      })
      .from(workflowExecutions)
      .innerJoin(
        workflowSubscriptionVersions,
        and(
          eq(
            workflowSubscriptionVersions.subscriptionId,
            workflowExecutions.subscriptionId,
          ),
          eq(
            workflowSubscriptionVersions.version,
            workflowExecutions.subscriptionVersion,
          ),
        ),
      )
      .where(
        and(
          eq(workflowSubscriptionVersions.kind, "deterministic"),
          eq(workflowSubscriptionVersions.ownerEmail, database.ownerEmail),
        ),
      )
      .orderBy(desc(workflowExecutions.createdAt))
      .limit(Math.min(limit * 10, 1_000));
    const rows = candidates
      .flatMap((row) => {
        const config = contentHookConfigFromJson(row.config);
        if (
          !config ||
          config.databaseId !== databaseId ||
          (hookId && row.hookId !== hookId)
        ) {
          return [];
        }
        return [
          {
            ...row,
            hookName: config.name,
            canRetry: row.status === "failed" || row.status === "unknown",
            canAcknowledge: row.status === "unknown",
          },
        ];
      })
      .slice(0, limit);
    if (rows.length === 0) return { databaseId, executions: [] };

    const executionIds = rows.map((row) => row.id);
    const effects = await db
      .select()
      .from(workflowEffects)
      .where(inArray(workflowEffects.executionId, executionIds))
      .orderBy(workflowEffects.createdAt);
    const effectIds = effects.map((effect) => effect.id);
    const attempts = effectIds.length
      ? await db
          .select()
          .from(notificationDeliveryAttempts)
          .where(inArray(notificationDeliveryAttempts.effectId, effectIds))
          .orderBy(
            notificationDeliveryAttempts.createdAt,
            notificationDeliveryAttempts.attempt,
          )
      : [];
    const attemptsByEffect = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      attemptsByEffect.set(attempt.effectId, [
        ...(attemptsByEffect.get(attempt.effectId) ?? []),
        attempt,
      ]);
    }
    const effectsByExecution = new Map<
      string,
      Array<{
        id: string;
        kind: ContentDatabaseHookEffectExecution["kind"];
        status: string;
        result: Record<string, unknown> | null;
        error: string | null;
        createdAt: number;
        updatedAt: number;
        deliveryAttempts: typeof attempts;
      }>
    >();
    for (const effect of effects) {
      effectsByExecution.set(effect.executionId, [
        ...(effectsByExecution.get(effect.executionId) ?? []),
        {
          id: effect.id,
          kind: ledgerEffectKind(effect.kind),
          status: effect.status,
          result: parseResult(effect.result),
          error: effect.errorMessage,
          createdAt: effect.createdAt,
          updatedAt: effect.updatedAt,
          deliveryAttempts: attemptsByEffect.get(effect.id) ?? [],
        },
      ]);
    }
    return {
      databaseId,
      executions: rows.map(({ config: _config, ...row }) => ({
        ...row,
        effects: effectsByExecution.get(row.id) ?? [],
      })),
    };
  },
});
