import { and, desc, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";

export type QueuedDraftStatus = "queued" | "in_review" | "sent" | "dismissed";

export type QueueScope = "review" | "requested" | "all";
export type QueueStatusFilter = QueuedDraftStatus | "active" | "all";

export type QueueContext = {
  userEmail: string;
  orgId: string;
  role: string;
};

export type OrgMember = {
  email: string;
  role: string;
  joinedAt: number;
};

export type QueuedEmailDraft = {
  id: string;
  orgId: string;
  ownerEmail: string;
  requesterEmail: string;
  requesterName: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  context: string;
  source: string;
  sourceThreadId: string;
  accountEmail: string;
  composeId: string;
  sentMessageId: string;
  status: QueuedDraftStatus;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAdminRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function serializeQueuedDraft(row: any): QueuedEmailDraft {
  return {
    id: row.id,
    orgId: row.orgId,
    ownerEmail: row.ownerEmail,
    requesterEmail: row.requesterEmail,
    requesterName: row.requesterName ?? "",
    to: row.toRecipients,
    cc: row.ccRecipients ?? "",
    bcc: row.bccRecipients ?? "",
    subject: row.subject,
    body: row.body,
    context: row.context ?? "",
    source: row.source,
    sourceThreadId: row.sourceThreadId ?? "",
    accountEmail: row.accountEmail ?? "",
    composeId: row.composeId ?? "",
    sentMessageId: row.sentMessageId ?? "",
    status: row.status,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    sentAt: row.sentAt == null ? null : Number(row.sentAt),
  };
}

async function getMembership(
  orgId: string,
  email: string,
): Promise<{ email: string; role: string } | null> {
  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: `SELECT email, role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, normalizeEmail(email)],
  });
  const row = rows[0] as any;
  if (!row) return null;
  return { email: String(row.email), role: String(row.role) };
}

export async function requireQueueContext(): Promise<QueueContext> {
  const userEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (!userEmail) throw new Error("Authentication required");
  if (!orgId) {
    throw new Error(
      "An active organization is required before email drafts can be queued.",
    );
  }

  const membership = await getMembership(orgId, userEmail);
  if (!membership) {
    throw new Error("Only members of this organization can queue drafts.");
  }

  return {
    userEmail: normalizeEmail(membership.email),
    orgId,
    role: membership.role,
  };
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: `SELECT email, role, joined_at AS "joinedAt" FROM org_members WHERE org_id = ? ORDER BY LOWER(email) ASC`,
    args: [orgId],
  });
  return rows.map((row: any) => ({
    email: String(row.email).toLowerCase(),
    role: String(row.role),
    joinedAt: Number(row.joinedAt ?? row.joined_at ?? 0),
  }));
}

export async function resolveOrgMemberEmail(
  orgId: string,
  member: string,
): Promise<string> {
  const query = normalizeEmail(member);
  const members = await listOrgMembers(orgId);
  const exact = members.find((m) => m.email.toLowerCase() === query);
  if (exact) return exact.email;

  const localMatches = members.filter(
    (m) =>
      m.email.split("@")[0]?.toLowerCase() === query ||
      m.email.toLowerCase().startsWith(query),
  );
  if (localMatches.length === 1) return localMatches[0].email;

  const available = members.map((m) => m.email).join(", ");
  if (localMatches.length > 1) {
    throw new Error(
      `More than one organization member matches "${member}". Use an exact email. Members: ${available}`,
    );
  }
  throw new Error(
    `No organization member found for "${member}". Members: ${available || "none"}`,
  );
}

export async function createQueuedDraft(input: {
  ownerEmail: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  context?: string;
  source?: string;
  sourceThreadId?: string;
  requesterName?: string;
  accountEmail?: string;
}): Promise<QueuedEmailDraft> {
  const ctx = await requireQueueContext();
  const ownerEmail = await resolveOrgMemberEmail(ctx.orgId, input.ownerEmail);
  if (!input.to.trim()) throw new Error("At least one recipient is required");
  if (!input.body.trim()) throw new Error("Draft body is required");

  const now = Date.now();
  const row = {
    id: `qd_${nanoid(12)}`,
    orgId: ctx.orgId,
    ownerEmail,
    requesterEmail: ctx.userEmail,
    requesterName: input.requesterName?.trim() || null,
    toRecipients: input.to.trim(),
    ccRecipients: input.cc?.trim() || null,
    bccRecipients: input.bcc?.trim() || null,
    subject: input.subject.trim() || "(no subject)",
    body: input.body.trim(),
    context: input.context?.trim() || null,
    source: input.source?.trim() || "agent",
    sourceThreadId: input.sourceThreadId?.trim() || null,
    accountEmail: input.accountEmail?.trim() || null,
    status: "queued" as const,
    createdAt: now,
    updatedAt: now,
  };

  await getDb().insert(schema.queuedEmailDrafts).values(row);
  return serializeQueuedDraft(row);
}

export async function getQueuedDraft(
  id: string,
  ctx?: QueueContext,
): Promise<QueuedEmailDraft | null> {
  const resolvedCtx = ctx ?? (await requireQueueContext());
  const rows = await getDb()
    .select()
    .from(schema.queuedEmailDrafts)
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, resolvedCtx.orgId),
      ),
    )
    .limit(1);
  return rows[0] ? serializeQueuedDraft(rows[0]) : null;
}

function assertCanAccessDraft(
  draft: QueuedEmailDraft,
  ctx: QueueContext,
  ownerOnly = false,
) {
  if (draft.orgId !== ctx.orgId) throw new Error("Draft not found");
  const isOwner = draft.ownerEmail === ctx.userEmail;
  const isRequester = draft.requesterEmail === ctx.userEmail;
  const isAdmin = isAdminRole(ctx.role);
  if (ownerOnly ? !isOwner && !isAdmin : !isOwner && !isRequester && !isAdmin) {
    throw new Error("You do not have access to this queued draft.");
  }
}

export async function requireQueuedDraft(
  id: string,
  options?: { ownerOnly?: boolean },
): Promise<{ ctx: QueueContext; draft: QueuedEmailDraft }> {
  const ctx = await requireQueueContext();
  const draft = await getQueuedDraft(id, ctx);
  if (!draft) throw new Error("Queued draft not found");
  assertCanAccessDraft(draft, ctx, options?.ownerOnly ?? false);
  return { ctx, draft };
}

export async function listQueuedDrafts(input: {
  scope?: QueueScope;
  status?: QueueStatusFilter;
  ownerEmail?: string;
  limit?: number;
}): Promise<QueuedEmailDraft[]> {
  const ctx = await requireQueueContext();
  const scope = input.scope ?? "review";
  const status = input.status ?? "active";
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const conditions = [eq(schema.queuedEmailDrafts.orgId, ctx.orgId)];

  if (status === "active") {
    conditions.push(
      or(
        eq(schema.queuedEmailDrafts.status, "queued"),
        eq(schema.queuedEmailDrafts.status, "in_review"),
      )!,
    );
  } else if (status !== "all") {
    conditions.push(eq(schema.queuedEmailDrafts.status, status));
  }

  if (scope === "review") {
    const owner = input.ownerEmail
      ? await resolveOrgMemberEmail(ctx.orgId, input.ownerEmail)
      : ctx.userEmail;
    if (owner !== ctx.userEmail && !isAdminRole(ctx.role)) {
      throw new Error(
        "Only organization admins can list another member's queue.",
      );
    }
    conditions.push(eq(schema.queuedEmailDrafts.ownerEmail, owner));
  } else if (scope === "requested") {
    conditions.push(eq(schema.queuedEmailDrafts.requesterEmail, ctx.userEmail));
  } else if (!isAdminRole(ctx.role)) {
    conditions.push(
      or(
        eq(schema.queuedEmailDrafts.ownerEmail, ctx.userEmail),
        eq(schema.queuedEmailDrafts.requesterEmail, ctx.userEmail),
      )!,
    );
  }

  const rows = await getDb()
    .select()
    .from(schema.queuedEmailDrafts)
    .where(and(...conditions))
    .orderBy(desc(schema.queuedEmailDrafts.createdAt))
    .limit(limit);

  return rows.map(serializeQueuedDraft);
}

export async function updateQueuedDraft(
  id: string,
  input: {
    ownerEmail?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    context?: string;
    status?: QueuedDraftStatus;
    accountEmail?: string;
    composeId?: string | null;
    sentMessageId?: string;
  },
): Promise<QueuedEmailDraft> {
  const { ctx, draft } = await requireQueuedDraft(id, { ownerOnly: true });
  if (draft.status === "sent" && input.status !== "sent") {
    throw new Error("Sent queued drafts cannot be edited.");
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.ownerEmail !== undefined) {
    updates.ownerEmail = await resolveOrgMemberEmail(
      ctx.orgId,
      input.ownerEmail,
    );
  }
  if (input.to !== undefined) updates.toRecipients = input.to.trim();
  if (input.cc !== undefined) updates.ccRecipients = input.cc.trim() || null;
  if (input.bcc !== undefined) updates.bccRecipients = input.bcc.trim() || null;
  if (input.subject !== undefined) {
    updates.subject = input.subject.trim() || "(no subject)";
  }
  if (input.body !== undefined) updates.body = input.body.trim();
  if (input.context !== undefined)
    updates.context = input.context.trim() || null;
  if (input.accountEmail !== undefined) {
    updates.accountEmail = input.accountEmail.trim() || null;
  }
  if (input.composeId !== undefined) updates.composeId = input.composeId;
  if (input.sentMessageId !== undefined) {
    updates.sentMessageId = input.sentMessageId.trim() || null;
  }
  if (input.status !== undefined) {
    updates.status = input.status;
    if (input.status === "sent") updates.sentAt = Date.now();
  }

  await getDb()
    .update(schema.queuedEmailDrafts)
    .set(updates)
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, ctx.orgId),
      ),
    );

  const updated = await getQueuedDraft(id, ctx);
  if (!updated) throw new Error("Queued draft not found after update.");
  return updated;
}

export async function openQueuedDraftInComposer(
  id: string,
): Promise<{ draft: QueuedEmailDraft; composeId: string }> {
  const { draft } = await requireQueuedDraft(id, { ownerOnly: true });
  if (draft.status === "sent" || draft.status === "dismissed") {
    throw new Error("Only active queued drafts can be opened.");
  }

  const composeId = draft.composeId || `queued-${nanoid(10)}`;
  await writeAppState(`compose-${composeId}`, {
    id: composeId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
    mode: "compose",
    accountEmail: draft.accountEmail || undefined,
    queuedDraftId: draft.id,
    queuedDraftRequesterEmail: draft.requesterEmail,
    queuedDraftContext: draft.context,
  });

  const updated = await updateQueuedDraft(id, {
    status: "in_review",
    composeId,
  });
  return { draft: updated, composeId };
}

export async function markQueuedDraftSent(
  id: string,
  sentMessageId?: string,
): Promise<QueuedEmailDraft> {
  await requireQueuedDraft(id, { ownerOnly: true });
  return updateQueuedDraft(id, {
    status: "sent",
    sentMessageId,
  });
}
