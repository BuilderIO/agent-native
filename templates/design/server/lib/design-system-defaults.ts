import { getDbExec } from "@agent-native/core/db";
import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";

import { isUniqueConstraintViolation } from "../../shared/db-conflict.js";
import { getDb, schema } from "../db/index.js";

type DesignSystemTx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export const DESIGN_SYSTEMS_ONE_DEFAULT_PER_SCOPE_INDEX =
  "design_systems_one_default_per_scope_idx";

/**
 * Clear every default in a scope except the earliest-created row, across
 * every owner/org at once. Release-time maintenance, not a per-request
 * helper -- reconciles duplicate defaults left by the pre-fix race so
 * `createDesignSystemsOneDefaultIndex` below can actually be created (a
 * UNIQUE INDEX creation fails outright while duplicates exist). Returns the
 * number of rows healed.
 *
 * Uses Drizzle's query builder rather than raw SQL specifically to avoid
 * hand-rolling a dialect-portable boolean literal in an UPDATE ... SET
 * clause; `schema.designSystems.isDefault`'s `{ mode: "boolean" }` column
 * type already handles that conversion for both dialects.
 */
export async function healDuplicateDesignSystemDefaults(): Promise<number> {
  const db = getDb();
  // guard:allow-unscoped — release-time maintenance reconciling every
  // owner/org scope's stray duplicate defaults left by the pre-fix race,
  // not a single caller's data. Read-only; the write below is scoped to the
  // exact stale row ids this computes.
  const flagged = await db
    .select({
      id: schema.designSystems.id,
      ownerEmail: schema.designSystems.ownerEmail,
      orgId: schema.designSystems.orgId,
    })
    .from(schema.designSystems)
    .where(eq(schema.designSystems.isDefault, true))
    .orderBy(asc(schema.designSystems.createdAt));

  const seenScopes = new Set<string>();
  const staleIds: string[] = [];
  for (const row of flagged) {
    const scopeKey = `${row.ownerEmail}\u0000${row.orgId ?? ""}`;
    if (seenScopes.has(scopeKey)) {
      staleIds.push(row.id);
    } else {
      seenScopes.add(scopeKey);
    }
  }

  if (staleIds.length > 0) {
    await db
      .update(schema.designSystems)
      .set({ isDefault: false, updatedAt: new Date().toISOString() })
      .where(inArray(schema.designSystems.id, staleIds));
  }

  return staleIds.length;
}

/**
 * Create the unique index enforcing at most one default design system per
 * (owner_email, org_id) scope. An application-level read-then-write inside a
 * transaction is not enough on Postgres READ COMMITTED: a SELECT over an
 * empty scope takes no row lock, so two concurrent create/proxy/set-default
 * transactions can each observe "no default yet" and each commit
 * isDefault: true. This index turns the loser's write into a real
 * unique-constraint error instead of a silent second default -- see
 * `insertDesignSystemClaimingDefault` and `setOwnedDesignSystemDefault`
 * below for the savepoint-and-retry recovery built on top of it.
 *
 * `COALESCE(org_id, '')` matters: a plain `UNIQUE(owner_email, org_id)`
 * would not catch duplicates for the no-org case, because standard SQL
 * unique constraints treat every `NULL` as distinct from every other `NULL`.
 * Normalizing `NULL` to `''` makes every no-org row for one owner collide
 * for uniqueness purposes, the same as it does for org-scoped rows.
 *
 * `WHERE is_default` (rather than `= true` / `= 1`) is deliberately
 * dialect-neutral: Postgres accepts a bare boolean column reference as a
 * partial-index predicate, and SQLite treats the same nonzero/zero integer
 * as truthy/falsy in a `WHERE` expression.
 *
 * `CREATE UNIQUE INDEX` fails outright while duplicate defaults exist, so
 * callers that want it to actually stick should call
 * `healDuplicateDesignSystemDefaults` first -- see `scripts/migrate-production.ts`,
 * the release-time authoritative caller, which runs both under
 * `withMigrationRuntime`. Throws on failure; callers decide how to degrade.
 */
export async function createDesignSystemsOneDefaultIndex(): Promise<void> {
  await getDbExec().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${DESIGN_SYSTEMS_ONE_DEFAULT_PER_SCOPE_INDEX} ON design_systems (owner_email, COALESCE(org_id, '')) WHERE is_default`,
  );
}

let oneDefaultIndexPromise: Promise<void> | null = null;

/**
 * Best-effort, request-time fallback for environments that never run
 * `scripts/migrate-production.ts` (local dev, tests). Hosted production runs
 * schema DDL exclusively through the release migration path -- a normal
 * request/plugin-boot call is blocked there by
 * `assertSchemaMutationAllowed()` (see `packages/core/src/db/client.ts`), so
 * this call fails soft and does nothing in that environment; the release
 * script is what actually creates the index for production.
 *
 * Only a successful attempt is memoized. A failure (duplicates not yet
 * healed, transient DB error, the production block above) is logged and the
 * memo is cleared, so the next call retries instead of disabling index
 * creation for the rest of the warm process.
 */
function ensureOneDefaultPerScopeIndex(): Promise<void> {
  if (!oneDefaultIndexPromise) {
    oneDefaultIndexPromise = createDesignSystemsOneDefaultIndex().catch(
      (err: unknown) => {
        console.warn(
          `[db] ${DESIGN_SYSTEMS_ONE_DEFAULT_PER_SCOPE_INDEX} not created — ` +
            "likely pre-existing duplicate defaults from the create/proxy " +
            "race predating this fix, or a production runtime that only " +
            "allows schema DDL through the release migration script. New " +
            "concurrent claims remain best-effort until then:",
          err instanceof Error ? err.message : err,
        );
        oneDefaultIndexPromise = null;
      },
    );
  }
  return oneDefaultIndexPromise;
}

/**
 * The default flag is scoped per (ownerEmail, orgId) pair, never globally. An
 * org-visible design system owned by another member must not participate in
 * this viewer's default, and a system in another org must not suppress the
 * default here.
 */
export function ownedDesignSystemScope(
  ownerEmail: string,
  orgId?: string | null,
): SQL | undefined {
  return orgId
    ? and(
        eq(schema.designSystems.ownerEmail, ownerEmail),
        eq(schema.designSystems.orgId, orgId),
      )
    : and(
        eq(schema.designSystems.ownerEmail, ownerEmail),
        isNull(schema.designSystems.orgId),
      );
}

/**
 * Clear every default flagged inside one owner/org scope, optionally keeping
 * one row flagged. Unsetting a default never conflicts with
 * `design_systems_one_default_per_scope_idx` (see server/plugins/db.ts) --
 * the index only covers rows where isDefault is true -- so this needs no
 * conflict handling of its own.
 */
export async function clearOwnedDesignSystemDefaults(
  tx: DesignSystemTx,
  {
    ownerEmail,
    orgId,
    now,
    keepId,
  }: {
    ownerEmail: string;
    orgId?: string | null;
    now: string;
    keepId?: string;
  },
): Promise<void> {
  await tx
    .update(schema.designSystems)
    .set({ isDefault: false, updatedAt: now })
    .where(
      and(
        ownedDesignSystemScope(ownerEmail, orgId),
        eq(schema.designSystems.isDefault, true),
        ...(keepId ? [ne(schema.designSystems.id, keepId)] : []),
      ),
    );
}

/**
 * Guess whether a design system about to be inserted becomes this owner's
 * default, and self-heal a scope a previous race already left with more than
 * one flagged row.
 *
 * This read is a fast-path guess, not the enforcement: on Postgres READ
 * COMMITTED, a SELECT over an empty scope takes no row lock, so a concurrent
 * insert can still commit its own default between this read and the caller's
 * write. `insertDesignSystemClaimingDefault` below is what actually holds the
 * invariant under real concurrency, using the
 * `design_systems_one_default_per_scope_idx` partial unique index.
 */
export async function claimOwnedDesignSystemDefault(
  tx: DesignSystemTx,
  {
    ownerEmail,
    orgId,
    now,
  }: { ownerEmail: string; orgId?: string | null; now: string },
): Promise<boolean> {
  // guard:allow-unscoped — ownedDesignSystemScope() below IS the
  // (ownerEmail, orgId) filter for this table; the guard's per-block regex
  // cannot follow the helper call.
  const owned = await tx
    .select({
      id: schema.designSystems.id,
      isDefault: schema.designSystems.isDefault,
    })
    .from(schema.designSystems)
    .where(ownedDesignSystemScope(ownerEmail, orgId))
    .orderBy(asc(schema.designSystems.createdAt));

  // A shared system must not stop the first system a user owns from becoming
  // their default, so an empty owned scope is what claims the flag.
  const claimsDefault = owned.length === 0;
  const flagged = owned.filter((row) => row.isDefault);

  if (claimsDefault) {
    await clearOwnedDesignSystemDefaults(tx, { ownerEmail, orgId, now });
  } else if (flagged.length > 1) {
    await clearOwnedDesignSystemDefaults(tx, {
      ownerEmail,
      orgId,
      now,
      keepId: flagged[0]!.id,
    });
  }

  return claimsDefault;
}

/**
 * Insert one design system row, claiming the owner's default when the scope
 * looks empty. `claimOwnedDesignSystemDefault`'s read is only a guess: two
 * concurrent create/proxy calls can both read an empty scope and both try to
 * commit `isDefault: true`. The `design_systems_one_default_per_scope_idx`
 * partial unique index is the real enforcement -- the loser's insert raises a
 * unique-constraint error instead of silently leaving two defaults.
 *
 * The insert runs inside a savepoint (`tx.transaction` nested inside the
 * caller's own transaction) so a losing insert can be rolled back and
 * retried without aborting the outer transaction. Retrying with
 * `isDefault: false` can never itself conflict, since the index only covers
 * rows where isDefault is true.
 */
export async function insertDesignSystemClaimingDefault(
  tx: DesignSystemTx,
  scope: { ownerEmail: string; orgId?: string | null; now: string },
  insertRow: (tx: DesignSystemTx, isDefault: boolean) => PromiseLike<unknown>,
): Promise<boolean> {
  await ensureOneDefaultPerScopeIndex();
  const claimsDefault = await claimOwnedDesignSystemDefault(tx, scope);

  try {
    await tx.transaction(async (savepoint) => {
      await insertRow(savepoint, claimsDefault);
    });
    return claimsDefault;
  } catch (err) {
    if (!claimsDefault || !isUniqueConstraintViolation(err)) throw err;
    // Lost the race: a concurrent insert committed its own default between
    // our read above and this insert. The design system itself must still be
    // saved, just without the flag the other insert already won.
    await tx.transaction(async (savepoint) => {
      await insertRow(savepoint, false);
    });
    return false;
  }
}

const MAX_DEFAULT_CLAIM_ATTEMPTS = 3;

/**
 * Set (or unset) one owned design system as the default. Unsetting can never
 * conflict with the unique index. Claiming it can: a concurrent
 * `setOwnedDesignSystemDefault` call for a different target can commit its
 * own default between this call's clear and its set, so the set raises a
 * unique-constraint error. Retry the clear-then-set pair inside a fresh
 * savepoint -- the next attempt's clear observes the committed winner and
 * removes it before this call sets its own target.
 */
export async function setOwnedDesignSystemDefault(
  tx: DesignSystemTx,
  {
    ownerEmail,
    orgId,
    now,
    targetId,
    isDefault,
  }: {
    ownerEmail: string;
    orgId?: string | null;
    now: string;
    targetId: string;
    isDefault: boolean;
  },
): Promise<void> {
  const targetScope = ownedDesignSystemScope(ownerEmail, orgId);

  if (!isDefault) {
    await tx
      .update(schema.designSystems)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(schema.designSystems.id, targetId), targetScope));
    return;
  }

  await ensureOneDefaultPerScopeIndex();

  for (let attempt = 1; attempt <= MAX_DEFAULT_CLAIM_ATTEMPTS; attempt += 1) {
    try {
      await tx.transaction(async (savepoint) => {
        await clearOwnedDesignSystemDefaults(savepoint, {
          ownerEmail,
          orgId,
          now,
          keepId: targetId,
        });
        await savepoint
          .update(schema.designSystems)
          .set({ isDefault: true, updatedAt: now })
          .where(and(eq(schema.designSystems.id, targetId), targetScope));
      });
      return;
    } catch (err) {
      if (
        attempt === MAX_DEFAULT_CLAIM_ATTEMPTS ||
        !isUniqueConstraintViolation(err)
      ) {
        throw err;
      }
    }
  }
}
