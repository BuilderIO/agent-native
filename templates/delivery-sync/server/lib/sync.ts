import { currentAccess } from "@agent-native/core/sharing";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ingestWorkItemsInTransaction,
  normalizedWorkItemSchema,
  ownerScopeKey,
} from "../../../delivery-workbench/server/lib/work-items.js";
import { getDb, schema } from "../db/index.js";

export const syncSourceInputSchema = z.object({
  provider: z.string().min(1),
  cursorKey: z.string().min(1).default("default"),
  cursorStart: z.string().optional(),
  cursorEnd: z.string().optional(),
  items: z.array(normalizedWorkItemSchema).max(1000).default([]),
});

export const reconcileSourceInputSchema = z.object({
  provider: z.string().min(1),
  cursorKey: z.string().min(1).default("default"),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const listSourceCursorsInputSchema = z.object({
  provider: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, "")}`;
}

function accessClause() {
  const { userEmail, orgId } = currentAccess();
  if (!userEmail) return sql`1=0`;
  return eq(schema.sourceCursors.scopeKey, ownerScopeKey(userEmail, orgId));
}

function isUniqueCursorError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /unique|duplicate/i.test(message) &&
    /delivery_source_cursors|source_cursors|provider_key|cursor/i.test(message)
  );
}

type SyncSourceOptions = {
  afterIngest?: () => void | Promise<void>;
};

async function syncSourceInternal(
  input: z.input<typeof syncSourceInputSchema>,
  options: SyncSourceOptions = {},
) {
  const args = syncSourceInputSchema.parse(input);
  const db = getDb();
  const { userEmail, orgId } = currentAccess();
  if (!userEmail)
    throw new Error("sync-source requires an authenticated user.");
  const scopeKey = ownerScopeKey(userEmail, orgId);

  const runSync = () =>
    db.transaction(async (tx) => {
      const timestamp = nowIso();
      const ingest = await ingestWorkItemsInTransaction(
        {
          provider: args.provider,
          cursorStart: args.cursorStart,
          cursorEnd: args.cursorEnd,
          items: args.items,
        },
        {
          db: tx as unknown as Parameters<
            typeof ingestWorkItemsInTransaction
          >[1]["db"],
          userEmail,
          orgId,
          startedAt: timestamp,
        },
      );
      await options.afterIngest?.();

      const [existing] = await tx
        .select()
        .from(schema.sourceCursors)
        .where(
          and(
            eq(schema.sourceCursors.scopeKey, scopeKey),
            eq(schema.sourceCursors.provider, args.provider),
            eq(schema.sourceCursors.cursorKey, args.cursorKey),
          ),
        )
        .limit(1);
      const cursorValue =
        args.cursorEnd ?? args.cursorStart ?? existing?.cursorValue ?? null;

      if (existing) {
        await tx
          .update(schema.sourceCursors)
          .set({
            cursorValue,
            lastSyncRunId: ingest.ingestRunId,
            lastSyncStatus: "succeeded",
            lastSyncedAt: timestamp,
            error: null,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(schema.sourceCursors.id, existing.id),
              eq(schema.sourceCursors.scopeKey, scopeKey),
            ),
          );
      } else {
        await tx.insert(schema.sourceCursors).values({
          id: createId("cursor"),
          scopeKey,
          provider: args.provider,
          cursorKey: args.cursorKey,
          cursorValue,
          lastSyncRunId: ingest.ingestRunId,
          lastSyncStatus: "succeeded",
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
          ownerEmail: userEmail,
          orgId: orgId ?? null,
        });
      }

      const archiveRows = args.items
        .filter((item) => item.rawRef)
        .map((item) => ({
          id: createId("raw"),
          provider: args.provider,
          sourceId: item.sourceId,
          rawRef: item.rawRef!,
          ingestRunId: ingest.ingestRunId,
          capturedAt: timestamp,
          retained: true,
          ownerEmail: userEmail,
          orgId: orgId ?? null,
        }));
      if (archiveRows.length > 0) {
        await tx.insert(schema.rawArchives).values(archiveRows);
      }

      return {
        provider: args.provider,
        cursorKey: args.cursorKey,
        cursorValue,
        ingest,
        rawArchiveCount: archiveRows.length,
      };
    });

  try {
    return await runSync();
  } catch (error) {
    if (isUniqueCursorError(error)) return runSync();
    throw error;
  }
}

export async function syncSource(input: z.input<typeof syncSourceInputSchema>) {
  return syncSourceInternal(input);
}

export async function syncSourceWithHooks(
  input: z.input<typeof syncSourceInputSchema>,
  options: SyncSourceOptions,
) {
  return syncSourceInternal(input, options);
}

export async function reconcileSource(
  input: z.input<typeof reconcileSourceInputSchema>,
) {
  const args = reconcileSourceInputSchema.parse(input);
  const [cursor] = await getDb()
    .select()
    .from(schema.sourceCursors)
    .where(
      and(
        accessClause(),
        eq(schema.sourceCursors.provider, args.provider),
        eq(schema.sourceCursors.cursorKey, args.cursorKey),
      ),
    )
    .limit(1);

  return {
    provider: args.provider,
    cursorKey: args.cursorKey,
    from: args.from ?? cursor?.cursorValue ?? null,
    to: args.to ?? null,
    status: "contract-placeholder",
    gap: "Provider API catalog/docs/request mounting is not complete in P1; adapters should pass normalized items to sync-source until provider-specific reconciliation is implemented.",
  };
}

export async function listSourceCursors(
  input: z.input<typeof listSourceCursorsInputSchema>,
) {
  const args = listSourceCursorsInputSchema.parse(input);
  const rows = await getDb()
    .select()
    .from(schema.sourceCursors)
    .where(
      and(
        accessClause(),
        args.provider
          ? eq(schema.sourceCursors.provider, args.provider)
          : undefined,
      ),
    )
    .orderBy(desc(schema.sourceCursors.updatedAt))
    .limit(args.limit);
  return rows;
}
