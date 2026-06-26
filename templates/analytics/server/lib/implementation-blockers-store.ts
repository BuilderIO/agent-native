import { recordChange } from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, asc, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * Org-scoped store for "Implementation Blockers". Customer-specific blocker
 * details live ONLY here (and never in source/git). Reads/writes are scoped via
 * the framework sharing helpers so a user only ever sees their org's rows.
 */

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

export type BlockerStatus = "active" | "monitoring" | "resolved";

export interface BlockerRecord {
  id: string;
  companyName: string;
  blockerType: string;
  status: BlockerStatus;
  summary: string;
  details: string;
  sortOrder: number;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export interface BlockerInput {
  companyName: string;
  blockerType?: string;
  status?: string;
  summary?: string;
  details?: string;
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

const STATUSES: ReadonlySet<string> = new Set([
  "active",
  "monitoring",
  "resolved",
]);

function normalizeStatus(raw: unknown): BlockerStatus {
  const v = String(raw ?? "").trim();
  return (STATUSES.has(v) ? v : "active") as BlockerStatus;
}

function rowToRecord(row: any): BlockerRecord {
  return {
    id: row.id,
    companyName: row.companyName,
    blockerType: row.blockerType ?? "",
    status: row.status,
    summary: row.summary ?? "",
    details: row.details ?? "",
    sortOrder: row.sortOrder ?? 0,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function writableScope(ctx: AccessCtx) {
  if (ctx.orgId) {
    return or(
      eq(schema.implementationBlockers.orgId, ctx.orgId),
      and(
        eq(schema.implementationBlockers.ownerEmail, ctx.email),
        isNull(schema.implementationBlockers.orgId),
      ),
    );
  }
  return and(
    eq(schema.implementationBlockers.ownerEmail, ctx.email),
    isNull(schema.implementationBlockers.orgId),
  );
}

function recordScoped(
  type: "change" | "delete",
  id: string,
  ctx: AccessCtx,
): void {
  recordChange({
    source: "implementation-blockers",
    type,
    key: id,
    ...(ctx.orgId ? { orgId: ctx.orgId } : { owner: ctx.email }),
  });
}

export async function listImplementationBlockers(
  ctx: AccessCtx,
): Promise<BlockerRecord[]> {
  const db = getDb() as any;
  const where = accessFilter(
    schema.implementationBlockers,
    schema.implementationBlockerShares,
    { userEmail: ctx.email, orgId: ctx.orgId ?? undefined },
  );
  const rows = await db
    .select()
    .from(schema.implementationBlockers)
    .where(where)
    .orderBy(
      asc(schema.implementationBlockers.sortOrder),
      asc(schema.implementationBlockers.companyName),
    );
  return rows.map(rowToRecord);
}

export async function replaceImplementationBlockers(
  blockers: BlockerInput[],
  ctx: AccessCtx,
): Promise<BlockerRecord[]> {
  const db = getDb() as any;
  const now = nowIso();
  const rows = blockers
    .map((b, i) => ({
      companyName: String(b.companyName ?? "").trim(),
      blockerType: String(b.blockerType ?? "").trim(),
      status: normalizeStatus(b.status),
      summary: String(b.summary ?? "").trim(),
      details: String(b.details ?? "").trim(),
      sortOrder:
        typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder)
          ? b.sortOrder
          : i,
    }))
    .filter((b) => b.companyName !== "")
    .map((b) => ({
      id: newId(),
      ...b,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "org" as const,
      createdAt: now,
      updatedAt: now,
    }));

  const replace = async (tx: any) => {
    await tx.delete(schema.implementationBlockers).where(writableScope(ctx));
    if (rows.length > 0) {
      await tx.insert(schema.implementationBlockers).values(rows);
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

export async function updateImplementationBlocker(
  id: string,
  patch: Partial<BlockerInput>,
  ctx: AccessCtx,
): Promise<BlockerRecord | null> {
  const access = await resolveAccess("implementation-blocker", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (!access) return null;
  await assertAccess("implementation-blocker", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });

  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.companyName !== undefined) {
    set.companyName = String(patch.companyName).trim();
  }
  if (patch.blockerType !== undefined) {
    set.blockerType = String(patch.blockerType).trim();
  }
  if (patch.status !== undefined) set.status = normalizeStatus(patch.status);
  if (patch.summary !== undefined) set.summary = String(patch.summary).trim();
  if (patch.details !== undefined) set.details = String(patch.details).trim();
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = patch.sortOrder;
  }

  const db = getDb() as any;
  await db
    .update(schema.implementationBlockers)
    .set(set)
    .where(eq(schema.implementationBlockers.id, id));
  const [row] = await db
    .select()
    .from(schema.implementationBlockers)
    .where(eq(schema.implementationBlockers.id, id));
  recordScoped("change", id, ctx);
  return row ? rowToRecord(row) : null;
}
