import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  lockContentDatabaseMutation,
  touchContentDatabase,
  withContentDatabaseMutationLock,
} from "./_content-database-mutation-lock.js";
import {
  applyMigration,
  deterministicId,
  digest,
  migrationPlanSchema,
  snapshotDigest,
  snapshotMigration,
  serializeMigrationValue,
  validatePlan,
} from "./_content-database-row-migration.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";

const operationalSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("validate"), plan: migrationPlanSchema }),
  z.object({ phase: z.literal("apply"), plan: migrationPlanSchema }),
  z.object({
    phase: z.literal("verify"),
    databaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    expectedPostDigest: z.string().min(1),
  }),
  z.object({
    phase: z.literal("rollback"),
    databaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    expectedPostDigest: z.string().min(1),
  }),
  z.object({
    phase: z.literal("finalize"),
    databaseId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    expectedPostDigest: z.string().min(1),
  }),
]);

function parseJson(text: string) {
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error("Migration receipt is corrupt.");
  }
}
function receiptResult(receipt: any, replayed: boolean) {
  const {
    plan: _plan,
    transitionExpectedPostDigest: _transitionExpectedPostDigest,
    ...result
  } = parseJson(receipt.resultJson);
  return {
    ...result,
    receiptId: receipt.id,
    state: receipt.state,
    preDigest: receipt.preDigest,
    postDigest: receipt.postDigest,
    replayed,
    verified: result.verified === true,
  };
}

async function lockCurrentDatabaseMemberships(tx: any, databaseId: string) {
  const memberships = await tx
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
  await lockDatabaseMemberships(
    tx,
    memberships.map((membership: { id: string }) => membership.id),
  );
}

export default defineAction({
  description:
    "Atomically migrate every active row in one ordinary Content database without attached Sources: validates an exact bounded plan, snapshots bodies, writes only new safe properties, and supports guarded rollback or legacy-property finalization.",
  schema: operationalSchema,
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "content-database",
      id:
        args.phase === "apply" || args.phase === "validate"
          ? args.plan.databaseId
          : args.databaseId,
      visibility: "private",
    }),
  },
  needsApproval: (args) =>
    args.phase === "rollback" || args.phase === "finalize",
  run: async (args) => {
    const db = getDb();
    const databaseId =
      args.phase === "apply" || args.phase === "validate"
        ? args.plan.databaseId
        : args.databaseId;
    return withContentDatabaseMutationLock(databaseId, async () => {
      const [database] = await db
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, databaseId));
      if (!database) throw new Error("Database not found.");
      await assertAccess("document", database.documentId, "admin");
      if (args.phase === "apply") {
        const replay = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(schema.contentDatabaseMigrationReceipts)
            .where(
              and(
                eq(
                  schema.contentDatabaseMigrationReceipts.databaseId,
                  args.plan.databaseId,
                ),
                eq(
                  schema.contentDatabaseMigrationReceipts.idempotencyKey,
                  args.plan.idempotencyKey,
                ),
              ),
            );
          const planHash = digest(args.plan);
          if (existing) {
            if (existing.planHash !== planHash)
              throw new Error(
                "Idempotency key was already used with a different migration plan.",
              );
            if (existing.state !== "applied" && existing.state !== "verified")
              throw new Error(
                `Migration receipt is already ${existing.state}.`,
              );
            if (
              snapshotDigest(
                await snapshotMigration(tx, args.plan.databaseId),
              ) !== existing.postDigest
            )
              throw new Error(
                "Applied migration has drifted; replay is refused.",
              );
            return receiptResult(existing, true);
          }
          validatePlan(
            args.plan,
            await snapshotMigration(tx, args.plan.databaseId),
            { checkTimestamps: false },
          );
          return null;
        });
        if (replay) return replay;
        for (const row of args.plan.rows) {
          const access = await assertAccess(
            "document",
            row.documentId,
            "editor",
          );
          await flushOpenDocumentEditorToSql({
            documentId: row.documentId,
            ownerEmail: access.resource.ownerEmail,
          });
        }
      }
      if (args.phase === "rollback") {
        const preflight = await db.transaction(async (tx) => {
          const [receipt] = await tx
            .select()
            .from(schema.contentDatabaseMigrationReceipts)
            .where(
              and(
                eq(
                  schema.contentDatabaseMigrationReceipts.databaseId,
                  args.databaseId,
                ),
                eq(
                  schema.contentDatabaseMigrationReceipts.idempotencyKey,
                  args.idempotencyKey,
                ),
              ),
            );
          if (!receipt) throw new Error("Migration receipt not found.");
          const result = parseJson(receipt.resultJson);
          const current = await snapshotMigration(tx, args.databaseId);
          if (receipt.state === "rolled_back") {
            if (
              result.transitionExpectedPostDigest !== args.expectedPostDigest ||
              snapshotDigest(current) !== receipt.postDigest
            )
              throw new Error(
                "Terminal migration result has drifted; replay is refused.",
              );
            return { replay: receiptResult(receipt, true), versions: [] };
          }
          if (receipt.state !== "applied" && receipt.state !== "verified")
            throw new Error(`Migration receipt is already ${receipt.state}.`);
          if (
            receipt.postDigest !== args.expectedPostDigest ||
            snapshotDigest(current) !== receipt.postDigest
          )
            throw new Error(
              "Migration has drifted; guarded operation is refused.",
            );
          return {
            replay: null,
            versions: parseJson(receipt.rollbackJson).versions ?? [],
          };
        });
        if (preflight.replay) return preflight.replay;
        for (const prior of preflight.versions) {
          const access = await assertAccess(
            "document",
            prior.documentId,
            "editor",
          );
          await flushOpenDocumentEditorToSql({
            documentId: prior.documentId,
            ownerEmail: access.resource.ownerEmail,
          });
        }
      }
      if (args.phase === "verify" || args.phase === "finalize") {
        const [receipt] = await db
          .select()
          .from(schema.contentDatabaseMigrationReceipts)
          .where(
            and(
              eq(
                schema.contentDatabaseMigrationReceipts.databaseId,
                args.databaseId,
              ),
              eq(
                schema.contentDatabaseMigrationReceipts.idempotencyKey,
                args.idempotencyKey,
              ),
            ),
          );
        if (!receipt) throw new Error("Migration receipt not found.");
        if (receipt.state === "applied" || receipt.state === "verified") {
          const plan = parseJson(receipt.resultJson).plan;
          if (!plan)
            throw new Error("Migration receipt lacks its verification plan.");
          for (const row of plan.rows)
            await assertAccess(
              "document",
              row.documentId,
              args.phase === "finalize" ? "editor" : "viewer",
            );
        }
      }
      if (args.phase === "verify" || args.phase === "finalize") {
        const replay = await db.transaction(async (tx) => {
          const [receipt] = await tx
            .select()
            .from(schema.contentDatabaseMigrationReceipts)
            .where(
              and(
                eq(
                  schema.contentDatabaseMigrationReceipts.databaseId,
                  args.databaseId,
                ),
                eq(
                  schema.contentDatabaseMigrationReceipts.idempotencyKey,
                  args.idempotencyKey,
                ),
              ),
            );
          if (!receipt) throw new Error("Migration receipt not found.");
          const storedResult = parseJson(receipt.resultJson);
          const isTerminalReplay =
            (args.phase === "verify" && receipt.state === "verified") ||
            (args.phase === "finalize" && receipt.state === "finalized");
          if (!isTerminalReplay) return null;
          const expectedDigest =
            args.phase === "verify"
              ? receipt.postDigest
              : storedResult.transitionExpectedPostDigest;
          if (expectedDigest !== args.expectedPostDigest)
            throw new Error(
              "Expected post-migration digest does not match receipt.",
            );
          if (
            snapshotDigest(await snapshotMigration(tx, args.databaseId)) !==
            receipt.postDigest
          )
            throw new Error(
              args.phase === "verify"
                ? "Migration has drifted; verification is refused."
                : "Terminal migration result has drifted; replay is refused.",
            );
          return receiptResult(receipt, true);
        });
        if (replay) return replay;
      }
      let mutated = false;
      const result = await db.transaction(async (tx) => {
        if (args.phase !== "validate") {
          await lockContentDatabaseMutation(
            tx as unknown as ReturnType<typeof getDb>,
            databaseId,
          );
          await lockCurrentDatabaseMemberships(tx, databaseId);
        }
        if (args.phase === "validate" || args.phase === "apply") {
          const planHash = digest(args.plan);
          if (args.phase === "apply") {
            const [existing] = await tx
              .select()
              .from(schema.contentDatabaseMigrationReceipts)
              .where(
                and(
                  eq(
                    schema.contentDatabaseMigrationReceipts.databaseId,
                    args.plan.databaseId,
                  ),
                  eq(
                    schema.contentDatabaseMigrationReceipts.idempotencyKey,
                    args.plan.idempotencyKey,
                  ),
                ),
              );
            if (existing) {
              if (existing.planHash !== planHash)
                throw new Error(
                  "Idempotency key was already used with a different migration plan.",
                );
              if (existing.state !== "applied" && existing.state !== "verified")
                throw new Error(
                  `Migration receipt is already ${existing.state}.`,
                );
              const current = await snapshotMigration(tx, args.plan.databaseId);
              if (snapshotDigest(current) !== existing.postDigest)
                throw new Error(
                  "Applied migration has drifted; replay is refused.",
                );
              return receiptResult(existing, true);
            }
          }
          const snapshot = await snapshotMigration(tx, args.plan.databaseId);
          validatePlan(args.plan, snapshot);
          const preDigest = snapshotDigest(snapshot);
          const orderedIds = snapshot.rows.map((row: any) => ({
            itemId: row.item.id,
            documentId: row.document.id,
          }));
          if (args.phase === "validate")
            return {
              phase: "validate",
              planHash,
              preDigest,
              counts: {
                rows: snapshot.rows.length,
                properties: args.plan.propertyDefinitions.length,
              },
              orderedIds,
              written: 0,
              replayed: false,
              verified: false,
            };
          const receiptId = deterministicId(
            "migration_receipt",
            args.plan.databaseId,
            args.plan.idempotencyKey,
          );
          const now = new Date().toISOString();
          await tx.insert(schema.contentDatabaseMigrationReceipts).values({
            id: receiptId,
            ownerEmail: snapshot.database.ownerEmail,
            orgId: snapshot.database.orgId,
            databaseId: args.plan.databaseId,
            databaseDocumentId: args.plan.databaseDocumentId,
            idempotencyKey: args.plan.idempotencyKey,
            planHash,
            state: "applying",
            preDigest,
            postDigest: preDigest,
            rollbackJson: "{}",
            resultJson: JSON.stringify({ phase: "apply", plan: args.plan }),
            createdAt: now,
            updatedAt: now,
          });
          const rollback = await applyMigration(
            tx,
            args.plan,
            snapshot,
            receiptId,
            now,
          );
          const current = await snapshotMigration(tx, args.plan.databaseId);
          const postDigest = snapshotDigest(current);
          const resultJson = {
            phase: "apply",
            planHash,
            legacyPropertyIds: args.plan.legacyPropertyIds,
            counts: {
              rows: args.plan.rows.length,
              properties: args.plan.propertyDefinitions.length,
            },
            orderedIds,
            written: args.plan.rows.length,
            verified: false,
            plan: args.plan,
          };
          const claimed = await tx
            .update(schema.contentDatabaseMigrationReceipts)
            .set({
              state: "applied",
              postDigest,
              rollbackJson: JSON.stringify(rollback),
              resultJson: JSON.stringify(resultJson),
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contentDatabaseMigrationReceipts.id, receiptId),
                eq(schema.contentDatabaseMigrationReceipts.state, "applying"),
              ),
            )
            .returning({ id: schema.contentDatabaseMigrationReceipts.id });
          if (claimed.length !== 1)
            throw new Error("Migration receipt claim was lost.");
          mutated = true;
          return {
            phase: "apply",
            planHash,
            legacyPropertyIds: args.plan.legacyPropertyIds,
            counts: resultJson.counts,
            orderedIds,
            written: args.plan.rows.length,
            verified: false,
            receiptId,
            state: "applied",
            preDigest,
            postDigest,
            replayed: false,
          };
        }
        const [receipt] = await tx
          .select()
          .from(schema.contentDatabaseMigrationReceipts)
          .where(
            and(
              eq(
                schema.contentDatabaseMigrationReceipts.databaseId,
                args.databaseId,
              ),
              eq(
                schema.contentDatabaseMigrationReceipts.idempotencyKey,
                args.idempotencyKey,
              ),
            ),
          );
        if (!receipt) throw new Error("Migration receipt not found.");
        const storedResult = parseJson(receipt.resultJson);
        if (args.phase === "verify" && receipt.state === "verified") {
          if (receipt.postDigest !== args.expectedPostDigest)
            throw new Error(
              "Expected post-migration digest does not match receipt.",
            );
          if (
            snapshotDigest(await snapshotMigration(tx, args.databaseId)) !==
            receipt.postDigest
          )
            throw new Error("Migration has drifted; verification is refused.");
          return receiptResult(receipt, true);
        }
        if (
          (args.phase === "rollback" && receipt.state === "rolled_back") ||
          (args.phase === "finalize" && receipt.state === "finalized")
        ) {
          if (
            storedResult.transitionExpectedPostDigest !==
            args.expectedPostDigest
          )
            throw new Error(
              "Expected post-migration digest does not match receipt.",
            );
          if (
            snapshotDigest(await snapshotMigration(tx, args.databaseId)) !==
            receipt.postDigest
          )
            throw new Error(
              "Terminal migration result has drifted; replay is refused.",
            );
          return receiptResult(receipt, true);
        }
        if (args.phase === "verify") {
          if (receipt.state !== "applied" && receipt.state !== "verified")
            throw new Error(`Migration receipt is already ${receipt.state}.`);
          if (receipt.postDigest !== args.expectedPostDigest)
            throw new Error(
              "Expected post-migration digest does not match receipt.",
            );
          const current = await snapshotMigration(tx, args.databaseId);
          if (snapshotDigest(current) !== receipt.postDigest)
            throw new Error("Migration has drifted; verification is refused.");
          const plan = parseJson(receipt.resultJson).plan;
          if (!plan)
            throw new Error("Migration receipt lacks its verification plan.");
          const newDefinitions = new Map(
            plan.propertyDefinitions.map((definition: any) => [
              definition.id,
              definition,
            ]),
          );
          if (
            current.definitions.filter((definition: any) =>
              newDefinitions.has(definition.id),
            ).length !== plan.propertyDefinitions.length
          )
            throw new Error(
              "Migration verification found a property definition count mismatch.",
            );
          for (const definition of plan.propertyDefinitions) {
            const actual = current.definitions.find(
              (candidate: any) => candidate.id === definition.id,
            );
            const optionsJson = JSON.stringify(
              definition.type === "multi_select"
                ? { options: definition.options }
                : {},
            );
            if (
              !actual ||
              actual.name !== definition.name.trim() ||
              actual.type !== definition.type ||
              actual.visibility !== definition.visibility ||
              actual.optionsJson !== optionsJson
            )
              throw new Error(
                "Migration verification found a property definition mismatch.",
              );
          }
          for (const row of plan.rows) {
            const persisted = current.rows.find(
              (candidate: any) =>
                candidate.item.id === row.itemId &&
                candidate.document.id === row.documentId,
            );
            if (!persisted || persisted.document.content !== row.content)
              throw new Error(
                "Migration verification found a row body mismatch.",
              );
            for (const value of row.propertyValues) {
              const actual = current.values.find(
                (candidate: any) =>
                  candidate.documentId === row.documentId &&
                  candidate.propertyId === value.propertyId,
              )?.valueJson;
              if (
                actual !==
                serializeMigrationValue(
                  newDefinitions.get(value.propertyId) as any,
                  value.value,
                )
              )
                throw new Error(
                  "Migration verification found a new property mismatch.",
                );
            }
            for (const protectedValue of row.protectedPropertyValues) {
              const actual =
                current.values.find(
                  (candidate: any) =>
                    candidate.documentId === row.documentId &&
                    candidate.propertyId === protectedValue.propertyId,
                )?.valueJson ?? "null";
              if (actual !== protectedValue.valueJson)
                throw new Error(
                  "Migration verification found a protected property mismatch.",
                );
            }
          }
          const now = new Date().toISOString();
          const resultJson = {
            ...parseJson(receipt.resultJson),
            phase: "verify",
            verified: true,
          };
          const transitioned = await tx
            .update(schema.contentDatabaseMigrationReceipts)
            .set({
              state: "verified",
              resultJson: JSON.stringify(resultJson),
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contentDatabaseMigrationReceipts.id, receipt.id),
                eq(schema.contentDatabaseMigrationReceipts.state, "applied"),
              ),
            )
            .returning({ id: schema.contentDatabaseMigrationReceipts.id });
          if (transitioned.length !== 1)
            throw new Error("Migration receipt state changed during verify.");
          mutated = true;
          return {
            receiptId: receipt.id,
            state: "verified",
            preDigest: receipt.preDigest,
            postDigest: receipt.postDigest,
            replayed: false,
            verified: true,
          };
        }
        if (args.phase === "finalize" && receipt.state !== "verified")
          throw new Error(
            "Migration receipt must be verified before finalization.",
          );
        if (
          args.phase === "rollback" &&
          receipt.state !== "applied" &&
          receipt.state !== "verified"
        )
          throw new Error(`Migration receipt is already ${receipt.state}.`);
        if (receipt.postDigest !== args.expectedPostDigest)
          throw new Error(
            "Expected post-migration digest does not match receipt.",
          );
        const current = await snapshotMigration(tx, args.databaseId);
        if (snapshotDigest(current) !== receipt.postDigest)
          throw new Error(
            "Migration has drifted; guarded operation is refused.",
          );
        const rollback = parseJson(receipt.rollbackJson);
        const now = new Date().toISOString();
        if (args.phase === "rollback") {
          for (const prior of rollback.versions ?? []) {
            const [version] = await tx
              .select()
              .from(schema.documentVersions)
              .where(eq(schema.documentVersions.id, prior.versionId));
            if (!version) throw new Error("Rollback snapshot is missing.");
            const restoredRows = await tx
              .update(schema.documents)
              .set({
                title: version.title,
                content: version.content,
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.documents.id, prior.documentId),
                  eq(schema.documents.updatedAt, prior.appliedUpdatedAt),
                ),
              )
              .returning({ id: schema.documents.id });
            if (restoredRows.length !== 1)
              throw new Error(
                `Rollback row ${prior.documentId} changed concurrently.`,
              );
          }
          const ids = rollback.createdPropertyIds ?? [];
          if (ids.length) {
            await tx
              .delete(schema.documentPropertyValues)
              .where(inArray(schema.documentPropertyValues.propertyId, ids));
            await tx
              .delete(schema.documentPropertyDefinitions)
              .where(inArray(schema.documentPropertyDefinitions.id, ids));
          }
          await tx
            .update(schema.contentDatabases)
            .set({ updatedAt: now })
            .where(eq(schema.contentDatabases.id, args.databaseId));
          const restored = await snapshotMigration(tx, args.databaseId);
          const postDigest = snapshotDigest(restored);
          if (postDigest !== receipt.preDigest)
            throw new Error("Rollback verification failed.");
          const resultJson = {
            phase: "rollback",
            transitionExpectedPostDigest: receipt.postDigest,
            counts: {
              rows: (rollback.versions ?? []).length,
              properties: ids.length,
            },
            verified: true,
          };
          const transitioned = await tx
            .update(schema.contentDatabaseMigrationReceipts)
            .set({
              state: "rolled_back",
              postDigest,
              resultJson: JSON.stringify(resultJson),
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contentDatabaseMigrationReceipts.id, receipt.id),
                inArray(schema.contentDatabaseMigrationReceipts.state, [
                  "applied",
                  "verified",
                ]),
              ),
            )
            .returning({ id: schema.contentDatabaseMigrationReceipts.id });
          if (transitioned.length !== 1)
            throw new Error("Migration receipt state changed during rollback.");
          mutated = true;
          return {
            receiptId: receipt.id,
            state: "rolled_back",
            preDigest: receipt.preDigest,
            postDigest,
            counts: {
              rows: (rollback.versions ?? []).length,
              properties: ids.length,
            },
            replayed: false,
            verified: true,
          };
        }
        const planResult = parseJson(receipt.resultJson);
        // Legacy ids are deliberately copied into the receipt result only after apply validation.
        const legacyIds: string[] = planResult.legacyPropertyIds ?? [];
        const legacy = current.definitions.filter((definition: any) =>
          legacyIds.includes(definition.id),
        );
        if (
          legacy.length !== legacyIds.length ||
          legacy.some(
            (definition: any) =>
              definition.systemRole || definition.type === "blocks",
          )
        )
          throw new Error("Legacy property is missing or unsafe to finalize.");
        if (legacyIds.length) {
          await tx
            .delete(schema.documentPropertyValues)
            .where(
              inArray(schema.documentPropertyValues.propertyId, legacyIds),
            );
          await tx
            .delete(schema.documentPropertyDefinitions)
            .where(inArray(schema.documentPropertyDefinitions.id, legacyIds));
        }
        await touchContentDatabase(
          tx as unknown as ReturnType<typeof getDb>,
          args.databaseId,
          now,
        );
        const finalized = await snapshotMigration(tx, args.databaseId);
        if (
          finalized.definitions.some((definition: any) =>
            legacyIds.includes(definition.id),
          ) ||
          finalized.values.some((value: any) =>
            legacyIds.includes(value.propertyId),
          )
        )
          throw new Error("Legacy property finalization verification failed.");
        const postDigest = snapshotDigest(finalized);
        const resultJson = {
          phase: "finalize",
          transitionExpectedPostDigest: receipt.postDigest,
          counts: { rows: 0, properties: legacyIds.length },
          verified: true,
        };
        const transitioned = await tx
          .update(schema.contentDatabaseMigrationReceipts)
          .set({
            state: "finalized",
            postDigest,
            resultJson: JSON.stringify(resultJson),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.contentDatabaseMigrationReceipts.id, receipt.id),
              eq(schema.contentDatabaseMigrationReceipts.state, "verified"),
            ),
          )
          .returning({ id: schema.contentDatabaseMigrationReceipts.id });
        if (transitioned.length !== 1)
          throw new Error("Migration receipt state changed during finalize.");
        mutated = true;
        return {
          receiptId: receipt.id,
          state: "finalized",
          preDigest: receipt.preDigest,
          postDigest,
          counts: { rows: 0, properties: legacyIds.length },
          replayed: false,
          verified: true,
        };
      });
      if (mutated)
        await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {
          // The receipt is already committed; polling reconciles this optional
          // UI hint when a concurrent SQLite writer briefly holds the database.
        });
      return result;
    });
  },
});
