import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../db/index.js";

export const SHARED_DISPATCHER_OWNER = "dispatcher@shared";
const APPROVAL_POLICY_KEY = "dispatcher-approval-policy";

export interface DispatcherApprovalPolicy {
  enabled: boolean;
  approverEmails: string[];
}

export interface DispatcherDestinationInput {
  id?: string;
  name: string;
  platform: string;
  destination: string;
  threadRef?: string | null;
  notes?: string | null;
}

type DispatcherApprovalRequest =
  typeof schema.dispatcherApprovalRequests.$inferSelect;

export function currentOwnerEmail(): string {
  return process.env.AGENT_USER_EMAIL || "local@localhost";
}

export function currentOrgId(): string | null {
  return process.env.AGENT_ORG_ID || null;
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

export async function getApprovalPolicy(): Promise<DispatcherApprovalPolicy> {
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

export async function setApprovalPolicy(input: DispatcherApprovalPolicy) {
  const orgId = currentOrgId();
  if (!orgId) {
    throw new Error(
      "Dispatcher approval settings require an active organization",
    );
  }
  await putOrgSetting(orgId, APPROVAL_POLICY_KEY, {
    enabled: input.enabled,
    approverEmails: input.approverEmails,
  });
  await recordAudit({
    action: "settings.updated",
    targetType: "dispatcher-settings",
    targetId: APPROVAL_POLICY_KEY,
    summary: input.enabled
      ? "Enabled approval flow for durable dispatcher changes"
      : "Disabled approval flow for durable dispatcher changes",
    metadata: input,
  });
  return getApprovalPolicy();
}

export async function recordAudit(input: {
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: unknown;
  actor?: string;
  ownerEmail?: string;
}) {
  const db = getDb();
  const timestamp = now();
  await db.insert(schema.dispatcherAuditEvents).values({
    id: id(),
    ownerEmail: input.ownerEmail || currentOwnerEmail(),
    orgId: currentOrgId(),
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
    .from(schema.dispatcherAuditEvents)
    .where(
      and(
        eq(schema.dispatcherAuditEvents.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatcherAuditEvents.orgId, orgId)
          : isNull(schema.dispatcherAuditEvents.orgId),
      ),
    )
    .orderBy(desc(schema.dispatcherAuditEvents.createdAt))
    .limit(limit);
}

export async function listDestinations() {
  const db = getDb();
  const orgId = currentOrgId();
  return db
    .select()
    .from(schema.dispatcherDestinations)
    .where(
      and(
        eq(schema.dispatcherDestinations.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatcherDestinations.orgId, orgId)
          : isNull(schema.dispatcherDestinations.orgId),
      ),
    )
    .orderBy(desc(schema.dispatcherDestinations.updatedAt));
}

export async function getDestinationById(destinationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatcherDestinations)
    .where(eq(schema.dispatcherDestinations.id, destinationId))
    .limit(1);
  return row ?? null;
}

async function applyDestinationUpsert(
  input: DispatcherDestinationInput,
  actor = currentOwnerEmail(),
) {
  const db = getDb();
  const timestamp = now();
  const destinationId = input.id || id();
  const existing = input.id ? await getDestinationById(input.id) : null;

  if (existing) {
    await db
      .update(schema.dispatcherDestinations)
      .set({
        name: input.name,
        platform: input.platform,
        destination: input.destination,
        threadRef: input.threadRef || null,
        notes: input.notes || null,
        updatedAt: timestamp,
      })
      .where(eq(schema.dispatcherDestinations.id, destinationId));
  } else {
    await db.insert(schema.dispatcherDestinations).values({
      id: destinationId,
      ownerEmail: currentOwnerEmail(),
      orgId: currentOrgId(),
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

  return getDestinationById(destinationId);
}

async function applyDestinationDelete(
  destinationId: string,
  actor = currentOwnerEmail(),
) {
  const db = getDb();
  const existing = await getDestinationById(destinationId);
  if (!existing) {
    throw new Error("Destination not found");
  }
  await db
    .delete(schema.dispatcherDestinations)
    .where(eq(schema.dispatcherDestinations.id, destinationId));
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
          subject: "Dispatcher approval requested",
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
  await db.insert(schema.dispatcherApprovalRequests).values({
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

export async function upsertDestination(input: DispatcherDestinationInput) {
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
    .from(schema.dispatcherApprovalRequests)
    .where(
      and(
        eq(schema.dispatcherApprovalRequests.ownerEmail, currentOwnerEmail()),
        orgId
          ? eq(schema.dispatcherApprovalRequests.orgId, orgId)
          : isNull(schema.dispatcherApprovalRequests.orgId),
      ),
    )
    .orderBy(desc(schema.dispatcherApprovalRequests.updatedAt));
}

async function getApprovalRequest(requestId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatcherApprovalRequests)
    .where(eq(schema.dispatcherApprovalRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

async function applyApprovedRequest(request: DispatcherApprovalRequest) {
  const payload = JSON.parse(request.payload);
  if (request.changeType === "destination.upsert") {
    return applyDestinationUpsert(
      payload,
      request.reviewedBy || currentOwnerEmail(),
    );
  }
  if (request.changeType === "destination.delete") {
    return applyDestinationDelete(
      payload.id,
      request.reviewedBy || currentOwnerEmail(),
    );
  }
  if (request.changeType === "approval-policy.update") {
    return setApprovalPolicy(payload);
  }
  throw new Error(`Unsupported approval request type: ${request.changeType}`);
}

export async function approveRequest(requestId: string) {
  const db = getDb();
  const request = await getApprovalRequest(requestId);
  if (!request) throw new Error("Approval request not found");
  if (request.status !== "pending") {
    throw new Error("Only pending approvals can be approved");
  }
  const timestamp = now();
  await db
    .update(schema.dispatcherApprovalRequests)
    .set({
      status: "approved",
      reviewedBy: currentOwnerEmail(),
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatcherApprovalRequests.id, requestId));
  const updated = await getApprovalRequest(requestId);
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
    .update(schema.dispatcherApprovalRequests)
    .set({
      status: "rejected",
      reviewedBy: currentOwnerEmail(),
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatcherApprovalRequests.id, requestId));
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
  await db.insert(schema.dispatcherLinkTokens).values({
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
    eq(schema.dispatcherIdentityLinks.ownerEmail, owner),
    orgId
      ? eq(schema.dispatcherIdentityLinks.orgId, orgId)
      : isNull(schema.dispatcherIdentityLinks.orgId),
  );
  const tokenFilters = and(
    eq(schema.dispatcherLinkTokens.ownerEmail, owner),
    orgId
      ? eq(schema.dispatcherLinkTokens.orgId, orgId)
      : isNull(schema.dispatcherLinkTokens.orgId),
  );
  const [links, tokens] = await Promise.all([
    db
      .select()
      .from(schema.dispatcherIdentityLinks)
      .where(filters)
      .orderBy(desc(schema.dispatcherIdentityLinks.updatedAt)),
    db
      .select()
      .from(schema.dispatcherLinkTokens)
      .where(tokenFilters)
      .orderBy(desc(schema.dispatcherLinkTokens.updatedAt)),
  ]);
  return { links, tokens };
}

export async function resolveLinkedOwner(
  platform: string,
  externalUserId?: string | null,
) {
  if (!externalUserId) return null;
  const db = getDb();
  const orgId = currentOrgId();
  const [row] = await db
    .select()
    .from(schema.dispatcherIdentityLinks)
    .where(
      and(
        eq(schema.dispatcherIdentityLinks.platform, platform),
        eq(schema.dispatcherIdentityLinks.externalUserId, externalUserId),
        orgId
          ? eq(schema.dispatcherIdentityLinks.orgId, orgId)
          : isNull(schema.dispatcherIdentityLinks.orgId),
      ),
    )
    .orderBy(desc(schema.dispatcherIdentityLinks.updatedAt))
    .limit(1);
  return row?.ownerEmail || null;
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
  const [tokenRow] = await db
    .select()
    .from(schema.dispatcherLinkTokens)
    .where(
      and(
        eq(schema.dispatcherLinkTokens.platform, input.platform),
        eq(schema.dispatcherLinkTokens.token, input.token),
      ),
    )
    .orderBy(desc(schema.dispatcherLinkTokens.createdAt))
    .limit(1);
  if (!tokenRow) throw new Error("Link token not found");
  if (tokenRow.claimedAt)
    throw new Error("Link token has already been claimed");
  if (tokenRow.expiresAt < now()) throw new Error("Link token has expired");

  const timestamp = now();
  const [existing] = await db
    .select()
    .from(schema.dispatcherIdentityLinks)
    .where(
      and(
        eq(schema.dispatcherIdentityLinks.platform, input.platform),
        eq(schema.dispatcherIdentityLinks.externalUserId, input.externalUserId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.dispatcherIdentityLinks)
      .set({
        ownerEmail: tokenRow.ownerEmail,
        orgId: tokenRow.orgId,
        externalUserName: input.externalUserName || null,
        linkedBy: tokenRow.createdBy,
        updatedAt: timestamp,
      })
      .where(eq(schema.dispatcherIdentityLinks.id, existing.id));
  } else {
    await db.insert(schema.dispatcherIdentityLinks).values({
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
    .update(schema.dispatcherLinkTokens)
    .set({
      claimedAt: timestamp,
      claimedByExternalUserId: input.externalUserId,
      claimedByExternalUserName: input.externalUserName || null,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatcherLinkTokens.id, tokenRow.id));

  await recordAudit({
    actor: tokenRow.createdBy,
    ownerEmail: tokenRow.ownerEmail,
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
