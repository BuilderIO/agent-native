import { writeAppState } from "@agent-native/core/application-state";
import { notify } from "@agent-native/core/notifications";
import { orgMembers } from "@agent-native/core/org";
import {
  getAppProductionUrl,
  getRequestOrgId,
  getRequestUserEmail,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { appendSignatureToBody } from "../../shared/signature.js";
import { getDb, schema } from "../db/index.js";

export type QueuedDraftStatus = "queued" | "in_review" | "sent" | "dismissed";

const SEND_CLAIM_TTL_MS = 15 * 60 * 1000;

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
  reviewUrl?: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAdminRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

function isQueueContextUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("An active organization is required") ||
    message.includes("Only members of this organization")
  );
}

export function serializeQueuedDraft(row: any): QueuedEmailDraft {
  const draft = {
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
  return { ...draft, reviewUrl: buildQueuedDraftUrl(draft.id) };
}

export function buildQueuedDraftUrl(id: string): string {
  const baseUrl = withConfiguredAppBasePath(getAppProductionUrl());
  return `${baseUrl}/draft-queue/${encodeURIComponent(id)}`;
}

async function getMembership(
  orgId: string,
  email: string,
): Promise<{ email: string; role: string } | null> {
  const [row] = await getDb()
    .select({ email: orgMembers.email, role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        sql`lower(${orgMembers.email}) = ${normalizeEmail(email)}`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return { email: row.email, role: row.role };
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
  const rows = await getDb()
    .select({
      email: orgMembers.email,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
    })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(asc(orgMembers.email));
  return rows.map((row) => ({
    email: row.email.toLowerCase(),
    role: row.role,
    joinedAt: Number(row.joinedAt),
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

  // Best-effort notify the owner so they see a bell badge and can click
  // through to review the draft. Self-queued drafts skip the notification.
  if (ownerEmail !== ctx.userEmail) {
    try {
      const requesterLabel = input.requesterName?.trim() || ctx.userEmail;
      await notify(
        {
          severity: "info",
          title: "Email draft ready for review",
          body: `${requesterLabel} queued a draft to ${row.toRecipients}: ${row.subject}`,
          metadata: {
            queuedDraftId: row.id,
            requesterEmail: ctx.userEmail,
            link: `/draft-queue/${encodeURIComponent(row.id)}`,
          },
        },
        { owner: ownerEmail },
      );
    } catch (err) {
      console.error("[queued-drafts] notify owner failed:", err);
    }
  }

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
  let ctx: QueueContext;
  try {
    ctx = await requireQueueContext();
  } catch (error) {
    if (isQueueContextUnavailable(error)) return [];
    throw error;
  }
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
  if (input.to !== undefined) {
    const to = input.to.trim();
    if (!to) throw new Error("At least one recipient is required");
    updates.toRecipients = to;
  }
  if (input.cc !== undefined) updates.ccRecipients = input.cc.trim() || null;
  if (input.bcc !== undefined) updates.bccRecipients = input.bcc.trim() || null;
  if (input.subject !== undefined) {
    updates.subject = input.subject.trim() || "(no subject)";
  }
  if (input.body !== undefined) {
    const body = input.body.trim();
    if (!body) throw new Error("Draft body is required");
    updates.body = body;
  }
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
  const ownerSettings = await getUserSetting(draft.ownerEmail, "mail-settings");
  const signature =
    typeof (ownerSettings as any)?.signature === "string"
      ? (ownerSettings as any).signature
      : undefined;
  await writeAppState(`compose-${composeId}`, {
    id: composeId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: appendSignatureToBody(draft.body, signature),
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

export type QueuedDraftClaim =
  | {
      claimed: true;
      ctx: QueueContext;
      draft: QueuedEmailDraft;
      claimId: string;
      priorStatus: QueuedDraftStatus;
    }
  | { claimed: false; reason: "sent" | "sending" | "dismissed" };

/**
 * Atomically claims a queued draft in a private send-claim column while keeping
 * the public status in one of its durable states ("queued" or "in_review").
 * That lets only one caller proceed to actually send the underlying email
 * without writing transient values into the constrained status column. Enforces
 * the same
 * owner-or-admin access check as requireQueuedDraft first, then uses a
 * single conditional UPDATE + RETURNING so two concurrent callers can't both
 * observe a sendable, unclaimed draft and both dispatch the real send.
 */
export async function claimQueuedDraftForSending(
  id: string,
): Promise<QueuedDraftClaim> {
  const { ctx, draft: preClaimDraft } = await requireQueuedDraft(id, {
    ownerOnly: true,
  });
  // Best portable witness of the pre-claim status: UPDATE ... RETURNING
  // yields POST-update values on both Postgres and SQLite, so it can never
  // be used to recover the prior status. The WHERE clause below guarantees
  // this row was "queued" or "in_review" at claim time if the update
  // affects it, so the pre-read status (when it's one of those two) is
  // exactly that prior status; otherwise default to "queued".
  const priorStatus: QueuedDraftStatus =
    preClaimDraft.status === "queued" || preClaimDraft.status === "in_review"
      ? preClaimDraft.status
      : "queued";
  const claimId = nanoid();
  const claimedAt = Date.now();
  const staleClaimBefore = claimedAt - SEND_CLAIM_TTL_MS;

  const claimed = await getDb()
    .update(schema.queuedEmailDrafts)
    .set({
      sendClaimId: claimId,
      sendClaimedAt: claimedAt,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, ctx.orgId),
        or(
          eq(schema.queuedEmailDrafts.status, "queued"),
          eq(schema.queuedEmailDrafts.status, "in_review"),
        ),
        sql`(${schema.queuedEmailDrafts.sendClaimId} IS NULL OR ${schema.queuedEmailDrafts.sendClaimedAt} < ${staleClaimBefore})`,
      ),
    )
    .returning({ sendClaimId: schema.queuedEmailDrafts.sendClaimId });

  if (claimed.length > 0) {
    const draft = await getQueuedDraft(id, ctx);
    if (!draft) throw new Error("Queued draft not found after claim.");
    return { claimed: true, ctx, draft, claimId, priorStatus };
  }

  // Lost the race (or nothing to claim) — report the real current status so
  // callers can distinguish "someone else is sending this right now" from
  // "this was already sent" instead of silently re-sending or erroring.
  const [current] = await getDb()
    .select({
      status: schema.queuedEmailDrafts.status,
      sendClaimId: schema.queuedEmailDrafts.sendClaimId,
    })
    .from(schema.queuedEmailDrafts)
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, ctx.orgId),
      ),
    )
    .limit(1);
  if (
    current?.sendClaimId &&
    (current.status === "queued" || current.status === "in_review")
  ) {
    return { claimed: false, reason: "sending" };
  }
  if (current?.status === "sent") return { claimed: false, reason: "sent" };
  return { claimed: false, reason: "dismissed" };
}

/**
 * Releases a failed send back to its pre-claim status so the draft is
 * retryable instead of stuck with an active send claim forever.
 */
export async function releaseQueuedDraftClaim(
  id: string,
  ctx: QueueContext,
  claimId: string,
  priorStatus: QueuedDraftStatus,
): Promise<void> {
  await getDb()
    .update(schema.queuedEmailDrafts)
    .set({
      status: priorStatus,
      sendClaimId: null,
      sendClaimedAt: null,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, ctx.orgId),
        eq(schema.queuedEmailDrafts.sendClaimId, claimId),
      ),
    );
}

export async function markQueuedDraftSent(
  id: string,
  ctx: QueueContext,
  claimId: string,
  sentMessageId?: string,
): Promise<QueuedEmailDraft> {
  const updates: Record<string, unknown> = {
    status: "sent",
    sendClaimId: null,
    sendClaimedAt: null,
    sentAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (sentMessageId !== undefined) {
    updates.sentMessageId = sentMessageId.trim() || null;
  }
  await getDb()
    .update(schema.queuedEmailDrafts)
    .set(updates)
    .where(
      and(
        eq(schema.queuedEmailDrafts.id, id),
        eq(schema.queuedEmailDrafts.orgId, ctx.orgId),
        eq(schema.queuedEmailDrafts.sendClaimId, claimId),
      ),
    );
  const updated = await getQueuedDraft(id, ctx);
  if (!updated) throw new Error("Queued draft not found after send.");
  return updated;
}
