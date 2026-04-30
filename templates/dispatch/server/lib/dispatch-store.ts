import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { hasRequestContext } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../db/index.js";

export const SHARED_DISPATCH_OWNER = "dispatch@shared";
const APPROVAL_POLICY_KEY = "dispatch-approval-policy";

export interface DispatchApprovalPolicy {
  enabled: boolean;
  approverEmails: string[];
}

export interface DispatchDestinationInput {
  id?: string;
  name: string;
  platform: string;
  destination: string;
  threadRef?: string | null;
  notes?: string | null;
}

type DispatchApprovalRequest =
  typeof schema.dispatchApprovalRequests.$inferSelect;

export function currentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export function currentOrgId(): string | null {
  return getRequestOrgId() || null;
}

/**
 * Caller-supplied access context for dispatch operations that work by
 * id (destinations, etc.). Looking up a row by id alone is unsafe —
 * UUIDs are not authorization. A row matches the ctx if either the
 * caller owns it or it lives in the caller's active org.
 */
export interface DispatchCtx {
  ownerEmail: string;
  orgId: string | null;
}

export function requireDispatchCtx(): DispatchCtx {
  return { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() };
}

function ctxScope<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: DispatchCtx,
) {
  if (!ctx.orgId) {
    return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
  }
  return or(eq(table.ownerEmail, ctx.ownerEmail), eq(table.orgId, ctx.orgId));
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export async function getApprovalPolicy(): Promise<DispatchApprovalPolicy> {
  const orgId = currentOrgId();
  if (!orgId) return { enabled: false, approverEmails: [] };
  const raw = await getOrgSetting(orgId, APPROVAL_POLICY_KEY);
  return {
    enabled: raw?.enabled === true,
    approverEmails: Array.isArray(raw?.approverEmails)
      ? raw.approverEmails.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

async function applyApprovalPolicy(
  input: DispatchApprovalPolicy,
  actor = currentOwnerEmail(),
) {
  const orgId = currentOrgId();
  if (!orgId) {
    throw new Error(
      "Dispatch approval settings require an active organization",
    );
  }
  await putOrgSetting(orgId, APPROVAL_POLICY_KEY, {
    enabled: input.enabled,
    approverEmails: input.approverEmails,
  });
  await recordAudit({
    action: "settings.updated",
    targetType: "dispatch-settings",
    targetId: APPROVAL_POLICY_KEY,
    summary: input.enabled
      ? "Enabled approval flow for durable dispatch changes"
      : "Disabled approval flow for durable dispatch changes",
    metadata: input,
    actor,
  });
  return getApprovalPolicy();
}

export async function setApprovalPolicy(input: DispatchApprovalPolicy) {
  const current = await getApprovalPolicy();
  if (!current.enabled) {
    return applyApprovalPolicy(input);
  }
  return createApprovalRequest({
    changeType: "approval-policy.update",
    targetType: "dispatch-settings",
    targetId: APPROVAL_POLICY_KEY,
    summary: input.enabled
      ? "Update dispatch approval policy"
      : "Disable dispatch approval policy",
    payload: input,
    beforeValue: current,
    afterValue: input,
  });
}

export async function recordAudit(input: {
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: unknown;
  actor?: string;
  ownerEmail?: string;
  orgId?: string | null;
}) {
  const db = getDb();
  const timestamp = now();
  await db.insert(schema.dispatchAuditEvents).values({
    id: id(),
    ownerEmail: input.ownerEmail || currentOwnerEmail(),
    orgId: input.orgId !== undefined ? input.orgId : currentOrgId(),
    actor: input.actor || currentOwnerEmail(),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId || null,
    summary: input.summary,
    metadata: input.metadata ? safeJson(input.metadata) : null,
    createdAt: timestamp,
  });
}

export async function listAuditEvents(limit = 50) {
  const db = getDb();
  const orgId = currentOrgId();
  return db
    .select()
    .from(schema.dispatchAuditEvents)
    .where(
      and(
        eq(schema.dispatchAuditEvents.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatchAuditEvents.orgId, orgId)
          : isNull(schema.dispatchAuditEvents.orgId),
      ),
    )
    .orderBy(desc(schema.dispatchAuditEvents.createdAt))
    .limit(limit);
}

export async function listDestinations() {
  const db = getDb();
  const orgId = currentOrgId();
  return db
    .select()
    .from(schema.dispatchDestinations)
    .where(
      and(
        eq(schema.dispatchDestinations.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatchDestinations.orgId, orgId)
          : isNull(schema.dispatchDestinations.orgId),
      ),
    )
    .orderBy(desc(schema.dispatchDestinations.updatedAt));
}

export async function getDestinationById(
  destinationId: string,
  ctx: DispatchCtx = requireDispatchCtx(),
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchDestinations)
    .where(
      and(
        eq(schema.dispatchDestinations.id, destinationId),
        ctxScope(schema.dispatchDestinations, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function applyDestinationUpsert(
  input: DispatchDestinationInput,
  actor = currentOwnerEmail(),
  ctx: DispatchCtx = requireDispatchCtx(),
) {
  const db = getDb();
  const timestamp = now();
  const destinationId = input.id || id();
  const existing = input.id ? await getDestinationById(input.id, ctx) : null;

  if (existing) {
    await db
      .update(schema.dispatchDestinations)
      .set({
        name: input.name,
        platform: input.platform,
        destination: input.destination,
        threadRef: input.threadRef || null,
        notes: input.notes || null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.dispatchDestinations.id, destinationId),
          ctxScope(schema.dispatchDestinations, ctx),
        ),
      );
  } else {
    await db.insert(schema.dispatchDestinations).values({
      id: destinationId,
      ownerEmail: ctx.ownerEmail,
      orgId: ctx.orgId,
      name: input.name,
      platform: input.platform,
      destination: input.destination,
      threadRef: input.threadRef || null,
      notes: input.notes || null,
      createdBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await recordAudit({
    actor,
    action: existing ? "destination.updated" : "destination.created",
    targetType: "destination",
    targetId: destinationId,
    summary: `${existing ? "Updated" : "Created"} ${input.platform} destination ${input.name}`,
    metadata: input,
  });

  return getDestinationById(destinationId, ctx);
}

async function applyDestinationDelete(
  destinationId: string,
  actor = currentOwnerEmail(),
  ctx: DispatchCtx = requireDispatchCtx(),
) {
  const db = getDb();
  const existing = await getDestinationById(destinationId, ctx);
  if (!existing) {
    throw new Error("Destination not found");
  }
  await db
    .delete(schema.dispatchDestinations)
    .where(
      and(
        eq(schema.dispatchDestinations.id, destinationId),
        ctxScope(schema.dispatchDestinations, ctx),
      ),
    );
  await recordAudit({
    actor,
    action: "destination.deleted",
    targetType: "destination",
    targetId: destinationId,
    summary: `Deleted ${existing.platform} destination ${existing.name}`,
    metadata: existing,
  });
  return existing;
}

async function notifyApprovers(requestId: string, summary: string) {
  const policy = await getApprovalPolicy();
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl || policy.approverEmails.length === 0) return;

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: policy.approverEmails.map((email) => ({ email })),
          subject: "Dispatch approval requested",
        },
      ],
      from: { email: from },
      content: [
        {
          type: "text/plain",
          value: `${summary}\n\nReview it here: ${appUrl}/approvals`,
        },
      ],
      custom_args: { requestId },
    }),
  }).catch(() => {});
}

async function createApprovalRequest(input: {
  changeType: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  payload: unknown;
  beforeValue?: unknown;
  afterValue?: unknown;
}) {
  const db = getDb();
  const timestamp = now();
  const requestId = id();
  await db.insert(schema.dispatchApprovalRequests).values({
    id: requestId,
    ownerEmail: currentOwnerEmail(),
    orgId: currentOrgId(),
    changeType: input.changeType,
    targetType: input.targetType,
    targetId: input.targetId || null,
    status: "pending",
    summary: input.summary,
    payload: safeJson(input.payload),
    beforeValue:
      input.beforeValue === undefined ? null : safeJson(input.beforeValue),
    afterValue:
      input.afterValue === undefined ? null : safeJson(input.afterValue),
    requestedBy: currentOwnerEmail(),
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await recordAudit({
    action: "approval.requested",
    targetType: input.targetType,
    targetId: input.targetId || requestId,
    summary: input.summary,
    metadata: input,
  });
  await notifyApprovers(requestId, input.summary);
  return getApprovalRequest(requestId);
}

export async function upsertDestination(input: DispatchDestinationInput) {
  const policy = await getApprovalPolicy();
  if (policy.enabled) {
    const existing = input.id ? await getDestinationById(input.id) : null;
    return createApprovalRequest({
      changeType: "destination.upsert",
      targetType: "destination",
      targetId: input.id || null,
      summary: `${existing ? "Update" : "Create"} ${input.platform} destination ${input.name}`,
      payload: input,
      beforeValue: existing,
      afterValue: input,
    });
  }
  return applyDestinationUpsert(input);
}

export async function deleteDestination(destinationId: string) {
  const policy = await getApprovalPolicy();
  const existing = await getDestinationById(destinationId);
  if (!existing) {
    throw new Error("Destination not found");
  }
  if (policy.enabled) {
    return createApprovalRequest({
      changeType: "destination.delete",
      targetType: "destination",
      targetId: destinationId,
      summary: `Delete ${existing.platform} destination ${existing.name}`,
      payload: { id: destinationId },
      beforeValue: existing,
      afterValue: null,
    });
  }
  return applyDestinationDelete(destinationId);
}

export async function listApprovalRequests() {
  const db = getDb();
  const orgId = currentOrgId();
  return db
    .select()
    .from(schema.dispatchApprovalRequests)
    .where(
      and(
        eq(schema.dispatchApprovalRequests.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatchApprovalRequests.orgId, orgId)
          : isNull(schema.dispatchApprovalRequests.orgId),
      ),
    )
    .orderBy(desc(schema.dispatchApprovalRequests.updatedAt));
}

async function getApprovalRequest(
  requestId: string,
  ctx: DispatchCtx = requireDispatchCtx(),
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchApprovalRequests)
    .where(
      and(
        eq(schema.dispatchApprovalRequests.id, requestId),
        ctxScope(schema.dispatchApprovalRequests, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function applyApprovedRequest(request: DispatchApprovalRequest) {
  const payload = JSON.parse(request.payload);
  const requestCtx = {
    ownerEmail: request.ownerEmail,
    orgId: request.orgId,
  };
  if (request.changeType === "destination.upsert") {
    return applyDestinationUpsert(
      payload,
      request.reviewedBy || currentOwnerEmail(),
      requestCtx,
    );
  }
  if (request.changeType === "destination.delete") {
    return applyDestinationDelete(
      payload.id,
      request.reviewedBy || currentOwnerEmail(),
      requestCtx,
    );
  }
  if (request.changeType === "approval-policy.update") {
    return applyApprovalPolicy(
      payload,
      request.reviewedBy || currentOwnerEmail(),
    );
  }
  throw new Error(`Unsupported approval request type: ${request.changeType}`);
}

export async function approveRequest(requestId: string) {
  const db = getDb();
  const ctx = requireDispatchCtx();
  const request = await getApprovalRequest(requestId, ctx);
  if (!request) throw new Error("Approval request not found");
  if (request.status !== "pending") {
    throw new Error("Only pending approvals can be approved");
  }
  const timestamp = now();
  await db
    .update(schema.dispatchApprovalRequests)
    .set({
      status: "approved",
      reviewedBy: currentOwnerEmail(),
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchApprovalRequests.id, requestId));
  const updated = await getApprovalRequest(requestId, ctx);
  if (!updated) throw new Error("Approval request disappeared");
  await applyApprovedRequest(updated);
  await recordAudit({
    action: "approval.approved",
    targetType: updated.targetType,
    targetId: requestId,
    summary: `Approved ${updated.summary}`,
    metadata: updated,
  });
  return updated;
}

export async function rejectRequest(requestId: string, reason?: string | null) {
  const db = getDb();
  const request = await getApprovalRequest(requestId);
  if (!request) throw new Error("Approval request not found");
  if (request.status !== "pending") {
    throw new Error("Only pending approvals can be rejected");
  }
  const timestamp = now();
  await db
    .update(schema.dispatchApprovalRequests)
    .set({
      status: "rejected",
      reviewedBy: currentOwnerEmail(),
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchApprovalRequests.id, requestId));
  await recordAudit({
    action: "approval.rejected",
    targetType: request.targetType,
    targetId: requestId,
    summary: `Rejected ${request.summary}`,
    metadata: { request, reason: reason || null },
  });
  return getApprovalRequest(requestId);
}

export async function createLinkToken(platform: string) {
  const db = getDb();
  const timestamp = now();
  const token = crypto.randomBytes(4).toString("hex");
  const recordId = id();
  const owner = currentOwnerEmail();
  await db.insert(schema.dispatchLinkTokens).values({
    id: recordId,
    token,
    ownerEmail: owner,
    orgId: currentOrgId(),
    platform,
    createdBy: owner,
    expiresAt: timestamp + 7 * 24 * 60 * 60 * 1000,
    claimedAt: null,
    claimedByExternalUserId: null,
    claimedByExternalUserName: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await recordAudit({
    action: "identity.link-token-created",
    targetType: "link-token",
    targetId: recordId,
    summary: `Created ${platform} link token for ${owner}`,
    metadata: { token, platform },
  });
  return {
    token,
    command: `/link ${token}`,
    platform,
    expiresAt: timestamp + 7 * 24 * 60 * 60 * 1000,
  };
}

export async function listIdentityState() {
  const db = getDb();
  const owner = currentOwnerEmail();
  const orgId = currentOrgId();
  const filters = and(
    eq(schema.dispatchIdentityLinks.ownerEmail, owner),
    orgId
      ? eq(schema.dispatchIdentityLinks.orgId, orgId)
      : isNull(schema.dispatchIdentityLinks.orgId),
  );
  const tokenFilters = and(
    eq(schema.dispatchLinkTokens.ownerEmail, owner),
    orgId
      ? eq(schema.dispatchLinkTokens.orgId, orgId)
      : isNull(schema.dispatchLinkTokens.orgId),
  );
  const [links, tokens] = await Promise.all([
    db
      .select()
      .from(schema.dispatchIdentityLinks)
      .where(filters)
      .orderBy(desc(schema.dispatchIdentityLinks.updatedAt)),
    db
      .select()
      .from(schema.dispatchLinkTokens)
      .where(tokenFilters)
      .orderBy(desc(schema.dispatchLinkTokens.updatedAt)),
  ]);
  return { links, tokens };
}

export async function resolveLinkedOwner(
  platform: string,
  externalUserId?: string | null,
) {
  if (!externalUserId) return null;
  const db = getDb();
  const hasContext = hasRequestContext();
  const orgId = currentOrgId();
  const rows = await db
    .select()
    .from(schema.dispatchIdentityLinks)
    .where(
      and(
        eq(schema.dispatchIdentityLinks.platform, platform),
        eq(schema.dispatchIdentityLinks.externalUserId, externalUserId),
        hasContext
          ? orgId
            ? eq(schema.dispatchIdentityLinks.orgId, orgId)
            : isNull(schema.dispatchIdentityLinks.orgId)
          : undefined,
      ),
    )
    .orderBy(desc(schema.dispatchIdentityLinks.updatedAt))
    .limit(2);
  if (!hasContext && rows.length > 1) return null;
  return rows[0]?.ownerEmail || null;
}

export async function consumeLinkToken(input: {
  platform: string;
  token: string;
  externalUserId?: string | null;
  externalUserName?: string | null;
}) {
  if (!input.externalUserId) {
    throw new Error("Linking requires a platform user id");
  }
  const db = getDb();
  const tokenRows = await db
    .select()
    .from(schema.dispatchLinkTokens)
    .where(
      and(
        eq(schema.dispatchLinkTokens.platform, input.platform),
        eq(schema.dispatchLinkTokens.token, input.token),
      ),
    )
    .orderBy(desc(schema.dispatchLinkTokens.createdAt))
    .limit(2);
  if (tokenRows.length > 1) {
    throw new Error("Link token is ambiguous. Create a fresh token and retry.");
  }
  const tokenRow = tokenRows[0];
  if (!tokenRow) throw new Error("Link token not found");
  if (tokenRow.claimedAt)
    throw new Error("Link token has already been claimed");
  if (tokenRow.expiresAt < now()) throw new Error("Link token has expired");

  const timestamp = now();
  const [existing] = await db
    .select()
    .from(schema.dispatchIdentityLinks)
    .where(
      and(
        eq(schema.dispatchIdentityLinks.platform, input.platform),
        eq(schema.dispatchIdentityLinks.externalUserId, input.externalUserId),
        tokenRow.orgId
          ? eq(schema.dispatchIdentityLinks.orgId, tokenRow.orgId)
          : isNull(schema.dispatchIdentityLinks.orgId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.dispatchIdentityLinks)
      .set({
        ownerEmail: tokenRow.ownerEmail,
        orgId: tokenRow.orgId,
        externalUserName: input.externalUserName || null,
        linkedBy: tokenRow.createdBy,
        updatedAt: timestamp,
      })
      .where(eq(schema.dispatchIdentityLinks.id, existing.id));
  } else {
    await db.insert(schema.dispatchIdentityLinks).values({
      id: id(),
      ownerEmail: tokenRow.ownerEmail,
      orgId: tokenRow.orgId,
      platform: input.platform,
      externalUserId: input.externalUserId,
      externalUserName: input.externalUserName || null,
      linkedBy: tokenRow.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await db
    .update(schema.dispatchLinkTokens)
    .set({
      claimedAt: timestamp,
      claimedByExternalUserId: input.externalUserId,
      claimedByExternalUserName: input.externalUserName || null,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchLinkTokens.id, tokenRow.id));

  await recordAudit({
    actor: tokenRow.createdBy,
    ownerEmail: tokenRow.ownerEmail,
    orgId: tokenRow.orgId,
    action: "identity.linked",
    targetType: "identity-link",
    targetId: input.externalUserId,
    summary: `Linked ${input.platform} user ${input.externalUserName || input.externalUserId}`,
    metadata: input,
  });

  return tokenRow.ownerEmail;
}

export async function listOverview() {
  const [destinations, approvals, identities, audit, settings] =
    await Promise.all([
      listDestinations(),
      listApprovalRequests(),
      listIdentityState(),
      listAuditEvents(12),
      getApprovalPolicy(),
    ]);

  return {
    counts: {
      destinations: destinations.length,
      pendingApprovals: approvals.filter((item) => item.status === "pending")
        .length,
      linkedIdentities: identities.links.length,
      activeTokens: identities.tokens.filter(
        (item) => !item.claimedAt && item.expiresAt > now(),
      ).length,
    },
    recentDestinations: destinations.slice(0, 5),
    recentApprovals: approvals.slice(0, 5),
    recentAudit: audit.slice(0, 8),
    settings,
  };
}
