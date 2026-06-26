import { recordChange } from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, asc, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { assertCanManageOrgRoster } from "./org-write-guard.js";

/**
 * Org-scoped store for the curated Strategic Accounts roster. The list is the
 * source of truth for the migrated overview and lives ONLY here (and the
 * dashboard config row) — never in source/git. Reads/writes are scoped through
 * the framework sharing helpers so a user only ever sees their org's rows.
 */

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

export interface StrategicAccountRecord {
  id: string;
  companyName: string;
  companyId: string | null;
  deploymentStatus: string;
  notes: string;
  sortOrder: number;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export interface StrategicAccountInput {
  companyName: string;
  companyId?: string | null;
  deploymentStatus?: string;
  notes?: string;
  sortOrder?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

function rowToRecord(row: any): StrategicAccountRecord {
  return {
    id: row.id,
    companyName: row.companyName,
    companyId: row.companyId ?? null,
    deploymentStatus: row.deploymentStatus ?? "",
    notes: row.notes ?? "",
    sortOrder: row.sortOrder ?? 0,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Rows the caller can write/replace in the current scope: their org's rows
 * when in an org, otherwise their own org-less rows. Mirrors the owner-scope
 * branch of `accessFilter` so seeding never touches another scope's data.
 */
function writableScope(ctx: AccessCtx) {
  if (ctx.orgId) {
    return or(
      eq(schema.strategicAccounts.orgId, ctx.orgId),
      and(
        eq(schema.strategicAccounts.ownerEmail, ctx.email),
        isNull(schema.strategicAccounts.orgId),
      ),
    );
  }
  return and(
    eq(schema.strategicAccounts.ownerEmail, ctx.email),
    isNull(schema.strategicAccounts.orgId),
  );
}

function recordScoped(
  type: "change" | "delete",
  id: string,
  ctx: AccessCtx,
): void {
  recordChange({
    source: "strategic-accounts",
    type,
    key: id,
    ...(ctx.orgId ? { orgId: ctx.orgId } : { owner: ctx.email }),
  });
}

/** List the org's curated accounts, ordered for the grid. */
export async function listStrategicAccounts(
  ctx: AccessCtx,
): Promise<StrategicAccountRecord[]> {
  const db = getDb() as any;
  const where = accessFilter(
    schema.strategicAccounts,
    schema.strategicAccountShares,
    { userEmail: ctx.email, orgId: ctx.orgId ?? undefined },
  );
  const rows = await db
    .select()
    .from(schema.strategicAccounts)
    .where(where)
    .orderBy(
      asc(schema.strategicAccounts.sortOrder),
      asc(schema.strategicAccounts.companyName),
    );
  return rows.map(rowToRecord);
}

/**
 * Atomically replace the caller-scope's curated roster in ONE write batch
 * (per the reliable-mutations rule — never loop inserts). Seeds visibility to
 * `org` so the whole organization sees the list. Returns the new rows.
 */
export async function replaceStrategicAccounts(
  accounts: StrategicAccountInput[],
  ctx: AccessCtx,
): Promise<StrategicAccountRecord[]> {
  await assertCanManageOrgRoster(ctx);
  const db = getDb() as any;
  const now = nowIso();
  const rows = accounts
    .map((a, i) => ({
      companyName: String(a.companyName ?? "").trim(),
      companyId:
        a.companyId === undefined || a.companyId === null
          ? null
          : String(a.companyId).trim() || null,
      deploymentStatus: String(a.deploymentStatus ?? "").trim(),
      notes: String(a.notes ?? "").trim(),
      sortOrder:
        typeof a.sortOrder === "number" && Number.isFinite(a.sortOrder)
          ? a.sortOrder
          : i,
    }))
    .filter((a) => a.companyName !== "")
    .map((a) => ({
      id: newId(),
      ...a,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "org" as const,
      createdAt: now,
      updatedAt: now,
    }));

  const replace = async (tx: any) => {
    await tx.delete(schema.strategicAccounts).where(writableScope(ctx));
    if (rows.length > 0) {
      await tx.insert(schema.strategicAccounts).values(rows);
    }
  };
  if (typeof db.transaction === "function") {
    await db.transaction(replace);
  } else {
    await replace(db);
  }

  recordScoped("change", "*", ctx);
  return rows.map(rowToRecord);
}

/** Edit one row's manual fields. Requires editor access to that row. */
export async function updateStrategicAccount(
  id: string,
  patch: Partial<
    Pick<
      StrategicAccountInput,
      "companyName" | "companyId" | "deploymentStatus" | "notes" | "sortOrder"
    >
  >,
  ctx: AccessCtx,
): Promise<StrategicAccountRecord | null> {
  const access = await resolveAccess("strategic-account", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (!access) return null;
  await assertAccess("strategic-account", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });

  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.companyName !== undefined) {
    set.companyName = String(patch.companyName).trim();
  }
  if (patch.companyId !== undefined) {
    set.companyId =
      patch.companyId === null ? null : String(patch.companyId).trim() || null;
  }
  if (patch.deploymentStatus !== undefined) {
    set.deploymentStatus = String(patch.deploymentStatus).trim();
  }
  if (patch.notes !== undefined) set.notes = String(patch.notes).trim();
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = patch.sortOrder;
  }

  const db = getDb() as any;
  await db
    .update(schema.strategicAccounts)
    .set(set)
    .where(eq(schema.strategicAccounts.id, id));
  const [row] = await db
    .select()
    .from(schema.strategicAccounts)
    .where(eq(schema.strategicAccounts.id, id));
  recordScoped("change", id, ctx);
  return row ? rowToRecord(row) : null;
}
