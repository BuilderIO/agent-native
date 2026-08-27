import { and, asc, eq, isNull, ne, type SQL } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

type DesignSystemTx = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

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
 * one row flagged. Callers run this inside the transaction that also writes
 * their own row so no create can interleave between the clear and the claim.
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
 * Decide whether a design system about to be inserted becomes this owner's
 * default, and leave the scope holding at most one flagged row.
 *
 * Both callers previously read the scope and then inserted with `isDefault`
 * derived from that read. Two creates racing (several sources syncing at once)
 * each saw "no default yet" and each claimed it, so the list rendered a Default
 * badge on more than one system. Reading and claiming in one transaction closes
 * that window, and healing an already-duplicated scope clears the badges a
 * previous race left behind.
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
