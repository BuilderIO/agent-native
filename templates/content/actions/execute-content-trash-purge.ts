import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  dispatchContentTrashPurge,
  hashTrashScopeToken,
} from "../server/lib/content-trash-purge.js";
import { assertTrashPurgePlanAuthority } from "./_content-trash-purge-scope.js";

export default defineAction({
  description:
    "Confirm and durably start an already reviewed Trash purge plan. Reusing an idempotency key returns the same operation.",
  schema: z.object({
    planId: z.string().uuid().describe("Reviewed purge plan ID"),
    scopeToken: z
      .string()
      .min(20)
      .describe("Opaque token returned with that plan"),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .describe("Caller-stable execution key"),
  }),
  needsApproval: true,
  run: async ({ planId, scopeToken, idempotencyKey }) => {
    const actorEmail = getRequestUserEmail();
    if (!actorEmail) {
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    const db = getDb();
    const resumeIncomplete = async (operation: {
      id: string;
      planId: string;
      status: string;
      leaseExpiresAt: string | null;
    }) => {
      await assertTrashPurgePlanAuthority(operation.planId);
      const resumable =
        operation.status === "retryable" ||
        (operation.status === "running" &&
          (!operation.leaseExpiresAt ||
            Date.parse(operation.leaseExpiresAt) <= Date.now()));
      if (!resumable) {
        return { operationId: operation.id, status: operation.status };
      }
      try {
        await dispatchContentTrashPurge(operation.id);
      } catch (error) {
        await db
          .update(schema.contentTrashPurgeOperations)
          .set({
            status: "retryable",
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.contentTrashPurgeOperations.id, operation.id));
        fail("Trash purge retry could not dispatch its next batch", {
          errorCode: "dispatch_failed",
          statusCode: 503,
          details: { operationId: operation.id },
        });
      }
      const [refreshed] = await db
        .select({ status: schema.contentTrashPurgeOperations.status })
        .from(schema.contentTrashPurgeOperations)
        .where(eq(schema.contentTrashPurgeOperations.id, operation.id))
        .limit(1);
      return {
        operationId: operation.id,
        status: refreshed?.status ?? "retryable",
      };
    };
    const [existing] = await db
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.actorEmail, actorEmail),
          eq(schema.contentTrashPurgeOperations.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      await assertTrashPurgePlanAuthority(existing.planId);
      if (existing.planId !== planId) {
        fail("Idempotency key was already used for another purge plan", {
          errorCode: "idempotency_conflict",
          statusCode: 409,
        });
      }
      return resumeIncomplete(existing);
    }
    const [existingForPlan] = await db
      .select()
      .from(schema.contentTrashPurgeOperations)
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.planId, planId),
          eq(schema.contentTrashPurgeOperations.actorEmail, actorEmail),
        ),
      )
      .limit(1);
    if (existingForPlan) {
      return resumeIncomplete(existingForPlan);
    }

    const [ownedPlan] = await db
      .select({ id: schema.contentTrashPurgePlans.id })
      .from(schema.contentTrashPurgePlans)
      .where(
        and(
          eq(schema.contentTrashPurgePlans.id, planId),
          eq(schema.contentTrashPurgePlans.actorEmail, actorEmail),
        ),
      )
      .limit(1);
    const plan = ownedPlan ? await assertTrashPurgePlanAuthority(planId) : null;
    if (!plan || plan.scopeTokenHash !== hashTrashScopeToken(scopeToken)) {
      fail("Purge plan or scope token is invalid", {
        errorCode: "invalid_scope",
        statusCode: 404,
      });
    }
    if (plan.state !== "ready" || Date.parse(plan.expiresAt) <= Date.now()) {
      fail("Purge plan expired; review the Trash scope again", {
        errorCode: "stale_scope",
        statusCode: 409,
      });
    }
    if (plan.eligibleCount === 0) {
      fail("This plan has no eligible Pages to delete", {
        errorCode: "empty_scope",
        statusCode: 409,
      });
    }
    const operationId = randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.insert(schema.contentTrashPurgeOperations).values({
        id: operationId,
        planId,
        actorEmail,
        orgId: plan.orgId,
        idempotencyKey,
        status: "queued",
        eligibleCount: plan.eligibleCount,
        blockedCount: plan.blockedCount,
        createdAt: now,
        updatedAt: now,
      });
      const [confirmationReceipt] = await tx
        .update(schema.contentTrashPurgePlans)
        .set({ state: "confirmed", updatedAt: now })
        .where(
          and(
            eq(schema.contentTrashPurgePlans.id, planId),
            eq(schema.contentTrashPurgePlans.state, "ready"),
          ),
        )
        .returning({ id: schema.contentTrashPurgePlans.id });
      if (!confirmationReceipt) {
        fail("Purge plan was already consumed", {
          errorCode: "stale_scope",
          statusCode: 409,
        });
      }
    });
    try {
      await dispatchContentTrashPurge(operationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [retryReceipt] = await db
        .update(schema.contentTrashPurgeOperations)
        .set({
          status: "retryable",
          lastError: message,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.contentTrashPurgeOperations.id, operationId),
            eq(schema.contentTrashPurgeOperations.status, "queued"),
          ),
        )
        .returning({ status: schema.contentTrashPurgeOperations.status });
      if (!retryReceipt) {
        const [current] = await db
          .select({ status: schema.contentTrashPurgeOperations.status })
          .from(schema.contentTrashPurgeOperations)
          .where(eq(schema.contentTrashPurgeOperations.id, operationId))
          .limit(1);
        if (!current)
          throw new Error("Trash purge operation disappeared after dispatch");
        return { operationId, status: current.status };
      }
      fail("Trash purge was saved but its worker could not be dispatched", {
        errorCode: "dispatch_failed",
        statusCode: 503,
        details: { operationId },
      });
    }
    const [dispatched] = await db
      .select({ status: schema.contentTrashPurgeOperations.status })
      .from(schema.contentTrashPurgeOperations)
      .where(eq(schema.contentTrashPurgeOperations.id, operationId))
      .limit(1);
    if (!dispatched)
      throw new Error("Trash purge operation disappeared after dispatch");
    return { operationId, status: dispatched.status };
  },
});
