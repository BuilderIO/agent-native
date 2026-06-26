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
 * Org-scoped store for "Strategic Account Coverage" contacts. Sensitive contact
 * details live ONLY here (and never in source/git). Reads/writes are scoped via
 * the framework sharing helpers so a user only ever sees their org's rows.
 */

export interface AccessCtx {
  email: string;
  orgId: string | null;
}

export type CoverageRole = "champion" | "enabler" | "exec_sponsor";
export type Confidence = "high" | "medium" | "low";

export interface ContactRecord {
  id: string;
  companyName: string;
  role: CoverageRole;
  contactName: string;
  title: string;
  email: string;
  confidence: Confidence;
  rationale: string;
  sortOrder: number;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  companyName: string;
  role?: string;
  contactName?: string;
  title?: string;
  email?: string;
  confidence?: string;
  rationale?: string;
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

const ROLES: ReadonlySet<string> = new Set([
  "champion",
  "enabler",
  "exec_sponsor",
]);
const CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);

function normalizeRole(raw: unknown): CoverageRole {
  const v = String(raw ?? "").trim();
  return (ROLES.has(v) ? v : "champion") as CoverageRole;
}

function normalizeConfidence(raw: unknown): Confidence {
  const v = String(raw ?? "").trim();
  return (CONFIDENCES.has(v) ? v : "medium") as Confidence;
}

function rowToRecord(row: any): ContactRecord {
  return {
    id: row.id,
    companyName: row.companyName,
    role: row.role,
    contactName: row.contactName ?? "",
    title: row.title ?? "",
    email: row.email ?? "",
    confidence: row.confidence,
    rationale: row.rationale ?? "",
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
      eq(schema.strategicAccountContacts.orgId, ctx.orgId),
      and(
        eq(schema.strategicAccountContacts.ownerEmail, ctx.email),
        isNull(schema.strategicAccountContacts.orgId),
      ),
    );
  }
  return and(
    eq(schema.strategicAccountContacts.ownerEmail, ctx.email),
    isNull(schema.strategicAccountContacts.orgId),
  );
}

function recordScoped(
  type: "change" | "delete",
  id: string,
  ctx: AccessCtx,
): void {
  recordChange({
    source: "strategic-account-contacts",
    type,
    key: id,
    ...(ctx.orgId ? { orgId: ctx.orgId } : { owner: ctx.email }),
  });
}

export async function listStrategicAccountContacts(
  ctx: AccessCtx,
): Promise<ContactRecord[]> {
  const db = getDb() as any;
  const where = accessFilter(
    schema.strategicAccountContacts,
    schema.strategicAccountContactShares,
    { userEmail: ctx.email, orgId: ctx.orgId ?? undefined },
  );
  const rows = await db
    .select()
    .from(schema.strategicAccountContacts)
    .where(where)
    .orderBy(
      asc(schema.strategicAccountContacts.sortOrder),
      asc(schema.strategicAccountContacts.companyName),
    );
  return rows.map(rowToRecord);
}

export async function replaceStrategicAccountContacts(
  contacts: ContactInput[],
  ctx: AccessCtx,
): Promise<ContactRecord[]> {
  await assertCanManageOrgRoster(ctx);
  const db = getDb() as any;
  const now = nowIso();
  const rows = contacts
    .map((c, i) => ({
      companyName: String(c.companyName ?? "").trim(),
      role: normalizeRole(c.role),
      contactName: String(c.contactName ?? "").trim(),
      title: String(c.title ?? "").trim(),
      email: String(c.email ?? "").trim(),
      confidence: normalizeConfidence(c.confidence),
      rationale: String(c.rationale ?? "").trim(),
      sortOrder:
        typeof c.sortOrder === "number" && Number.isFinite(c.sortOrder)
          ? c.sortOrder
          : i,
    }))
    .filter((c) => c.companyName !== "")
    .map((c) => ({
      id: newId(),
      ...c,
      ownerEmail: ctx.email,
      orgId: ctx.orgId,
      visibility: "org" as const,
      createdAt: now,
      updatedAt: now,
    }));

  const replace = async (tx: any) => {
    await tx.delete(schema.strategicAccountContacts).where(writableScope(ctx));
    if (rows.length > 0) {
      await tx.insert(schema.strategicAccountContacts).values(rows);
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

export async function updateStrategicAccountContact(
  id: string,
  patch: Partial<ContactInput>,
  ctx: AccessCtx,
): Promise<ContactRecord | null> {
  const access = await resolveAccess("strategic-account-contact", id, {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });
  if (!access) return null;
  await assertAccess("strategic-account-contact", id, "editor", {
    userEmail: ctx.email,
    orgId: ctx.orgId ?? undefined,
  });

  const set: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.companyName !== undefined) {
    set.companyName = String(patch.companyName).trim();
  }
  if (patch.role !== undefined) set.role = normalizeRole(patch.role);
  if (patch.contactName !== undefined) {
    set.contactName = String(patch.contactName).trim();
  }
  if (patch.title !== undefined) set.title = String(patch.title).trim();
  if (patch.email !== undefined) set.email = String(patch.email).trim();
  if (patch.confidence !== undefined) {
    set.confidence = normalizeConfidence(patch.confidence);
  }
  if (patch.rationale !== undefined) {
    set.rationale = String(patch.rationale).trim();
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = patch.sortOrder;
  }

  const db = getDb() as any;
  await db
    .update(schema.strategicAccountContacts)
    .set(set)
    .where(eq(schema.strategicAccountContacts.id, id));
  const [row] = await db
    .select()
    .from(schema.strategicAccountContacts)
    .where(eq(schema.strategicAccountContacts.id, id));
  recordScoped("change", id, ctx);
  return row ? rowToRecord(row) : null;
}
