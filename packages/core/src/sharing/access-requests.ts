import { and, asc, eq } from "drizzle-orm";

import { fail } from "../action.js";
import { getDbExec, withDbExec } from "../db/client.js";
import {
  CORE_ACCESS_GRANTED_EMAIL_ID,
  CORE_ACCESS_REQUESTED_EMAIL_ID,
  renderTransactionalEmail,
} from "../email-catalog/templates.js";
import { notifyWithDelivery } from "../notifications/registry.js";
import { getAppProductionUrl } from "../server/app-url.js";
import type { EmailTemplateApp } from "../server/email-template.js";
import { resolveEmailBrandApp } from "../server/email-templates.js";
import { isEmailConfigured, sendEmail } from "../server/email.js";
import { getUserProfile } from "../user-profile/store.js";
import {
  decideAccessRequest,
  deleteAccessRequest,
  findAccessRequest,
  getAccessRequest,
  listPendingAccessRequests,
  countRecentAccessRequests,
  openAccessRequest,
  recordAccessRequestDelivery,
  type AccessRequestRow,
} from "./access-request-store.js";
import {
  currentAccess,
  resolveAccess,
  resolveAccessStatus,
  type ResourceAccessStatus,
} from "./access.js";
import {
  isSyntheticQaEmail,
  resolveShareNotificationUrl,
} from "./actions/share-resource.js";
import { announceResourceAccessChange, grantResourceAccess } from "./grant.js";
import { filterRecipientsByResourceAccess } from "./recipients.js";
import {
  requireShareableResource,
  type ShareableResourceRegistration,
} from "./registry.js";
import type { ShareRole } from "./schema.js";

export const ACCESS_REQUEST_NOTE_MAX_LENGTH = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a declined requester waits before they can ask again. */
export const ACCESS_REQUEST_DECLINE_COOLDOWN_MS = 7 * DAY_MS;
/** Requests one person can make in a day, across every resource. */
export const ACCESS_REQUESTS_PER_REQUESTER_PER_DAY = 20;
/** Requests one owner can receive in a day, across their resources. */
export const ACCESS_REQUESTS_PER_OWNER_PER_DAY = 50;
// People shared directly as admin who hear about a request, besides the owner.
const ADMIN_RECIPIENT_LIMIT = 20;
const PENDING_LIST_LIMIT = 50;

/** Where someone who manages access reviews a request, relative to the app. */
export function accessRequestReviewPath(requestId: string): string {
  return `/access-requests/${encodeURIComponent(requestId)}`;
}

/** The viewer's own request, as their access screen shows it. */
export interface ViewerAccessRequest {
  state: "pending";
  requestedAt: string;
}

export interface ResourceLinkStatus extends ResourceAccessStatus {
  /** Whether the viewer can ask for access now. Only for `denied`. */
  canRequest?: boolean;
  /** The viewer's open request, if any. Only for `denied`. */
  request?: ViewerAccessRequest;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function viewerEmail(): string | null {
  return currentAccess().userEmail?.trim().toLowerCase() || null;
}

// A declined request reads to the requester as still pending until the
// cooldown ends, so declining tells them nothing and they can't ask again
// straight away.
function openRequestFor(
  row: AccessRequestRow | null,
  now: number,
): ViewerAccessRequest | undefined {
  if (!row) return undefined;
  const open =
    row.state === "pending" ||
    (row.state === "declined" &&
      row.decidedAt !== null &&
      row.decidedAt > now - ACCESS_REQUEST_DECLINE_COOLDOWN_MS);
  return open
    ? { state: "pending", requestedAt: iso(row.requestedAt) }
    : undefined;
}

/**
 * {@link resolveAccessStatus}, plus whether a viewer who can't open the
 * resource can ask for access, and their own open request if they already
 * asked. Registrations without `accessRequests` never offer it.
 */
export async function resolveLinkStatus(
  resourceType: string,
  resourceId: string,
): Promise<ResourceLinkStatus> {
  const status = await resolveAccessStatus(resourceType, resourceId);
  const reg = requireShareableResource(resourceType);
  const email = viewerEmail();
  if (status.state !== "denied" || !reg.accessRequests || !email) {
    return status;
  }
  const request = openRequestFor(
    await findAccessRequest(resourceType, resourceId, email),
    Date.now(),
  );
  return request
    ? { ...status, canRequest: false, request }
    : { ...status, canRequest: true };
}

function requireSignedIn(message: string): string {
  const email = viewerEmail();
  if (!email) fail(message, { errorCode: "sign_in_required", statusCode: 401 });
  return email;
}

async function loadResource(
  reg: ShareableResourceRegistration,
  resourceId: string,
): Promise<any | undefined> {
  const [resource] = await (reg.getDb() as any)
    .select()
    .from(reg.resourceTable)
    .where(eq(reg.resourceTable.id, resourceId));
  return resource;
}

function resourceTitle(
  reg: ShareableResourceRegistration,
  resource: any,
): string {
  const title = resource?.[reg.titleColumn ?? "title"];
  return typeof title === "string" && title.trim()
    ? title.trim()
    : reg.displayName;
}

function resourcePath(
  reg: ShareableResourceRegistration,
  resource: any,
): string | undefined {
  return reg.getResourcePath ? reg.getResourcePath(resource) : undefined;
}

async function emailBrand(
  reg: ShareableResourceRegistration,
  resource: any,
): Promise<EmailTemplateApp> {
  const app = resolveEmailBrandApp();
  let name = app.name;
  let logoUrl = app.logoUrl;
  try {
    name = (await reg.getBrandName?.(resource))?.trim() || name;
  } catch (err) {
    console.error("[access-requests] brand name resolver failed:", err);
  }
  try {
    logoUrl = (await reg.getLogoUrl?.(resource)) ?? logoUrl;
  } catch (err) {
    console.error("[access-requests] brand logo resolver failed:", err);
  }
  return { name, logoUrl };
}

// The owner and people shared directly as admin, kept only while their access
// still resolves to admin: on a restricted resource an admin share grants
// nothing outside its organization, and a request carries the title and the
// note. Anyone who manages access another way, through an organization, a
// group, or the app's own rule, sees requests in the Share panel instead.
async function requestRecipients(
  reg: ShareableResourceRegistration,
  resource: any,
  request: AccessRequestRow,
): Promise<string[]> {
  const rows = await (reg.getDb() as any)
    .select({ principalId: reg.sharesTable.principalId })
    .from(reg.sharesTable)
    .where(
      and(
        eq(reg.sharesTable.resourceId, request.resourceId),
        eq(reg.sharesTable.principalType, "user"),
        eq(reg.sharesTable.role, "admin"),
      ),
    )
    .orderBy(asc(reg.sharesTable.createdAt))
    .limit(ADMIN_RECIPIENT_LIMIT);
  const candidates = Array.from(
    new Set([
      request.ownerEmail,
      ...rows.map((row: { principalId: string }) =>
        row.principalId.trim().toLowerCase(),
      ),
    ]),
  ).filter((email) => email && email !== request.requesterEmail);
  return filterRecipientsByResourceAccess({
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    emails: candidates,
    orgId: resource.orgId,
    minimumRole: "admin",
  });
}

async function enforceRequestLimits(
  requesterEmail: string,
  ownerEmail: string,
  now: number,
): Promise<void> {
  const since = now - DAY_MS;
  for (const [by, limit] of [
    [{ requesterEmail }, ACCESS_REQUESTS_PER_REQUESTER_PER_DAY],
    [{ ownerEmail }, ACCESS_REQUESTS_PER_OWNER_PER_DAY],
  ] as const) {
    const recent = await countRecentAccessRequests(by, since);
    if (recent.count <= limit) continue;
    const retryAt = iso((recent.oldestAt ?? now) + DAY_MS);
    fail("Too many access requests right now. Try again later.", {
      errorCode: "access_request_rate_limited",
      statusCode: 429,
      details: { retryAt },
    });
  }
}

interface AccessRequestDelivery {
  recipients: number;
  inbox: number;
  email: number;
  failed: number;
}

async function deliverAccessRequest(
  reg: ShareableResourceRegistration,
  resource: any,
  request: AccessRequestRow,
): Promise<AccessRequestDelivery> {
  const recipients = await requestRecipients(reg, resource, request);
  const title = resourceTitle(reg, resource);
  const requesterName = request.requesterName || request.requesterEmail;
  const reviewPath = accessRequestReviewPath(request.id);
  const sendsEmail = await isEmailConfigured();
  const reviewUrl = resolveShareNotificationUrl(undefined, reviewPath);
  const resourceUrl = resolveShareNotificationUrl(
    undefined,
    resourcePath(reg, resource),
  );
  const app = sendsEmail ? await emailBrand(reg, resource) : null;
  const key = `access-request:${request.id}:${request.generation}`;
  const delivery: AccessRequestDelivery = {
    recipients: recipients.length,
    inbox: 0,
    email: 0,
    failed: 0,
  };

  for (const recipient of recipients) {
    try {
      const result = await notifyWithDelivery(
        {
          severity: "info",
          title: `${requesterName} is asking for access to "${title}"`,
          body: request.note ?? undefined,
          // Only the inbox: the email channel would go to workspace-wide
          // recipients, and the email below already reaches this person.
          channels: ["inbox"],
          metadata: {
            link: reviewPath,
            kind: "access-request",
            resourceType: request.resourceType,
            resourceId: request.resourceId,
            requestId: request.id,
          },
          idempotencyKey: key,
        },
        { owner: recipient },
      );
      if (result.notification) delivery.inbox++;
      else delivery.failed++;
    } catch (err) {
      delivery.failed++;
      console.error("[access-requests] request notification failed:", err);
    }

    if (!app || isSyntheticQaEmail(recipient)) continue;
    try {
      const { subject, html, text } = await renderTransactionalEmail(
        CORE_ACCESS_REQUESTED_EMAIL_ID,
        {
          recipientEmail: recipient,
          requester: { name: requesterName, email: request.requesterEmail },
          resource: {
            type: request.resourceType,
            label: reg.displayName,
            title,
            url: resourceUrl,
          },
          reviewUrl,
          note: request.note ?? undefined,
          app,
        },
      );
      await sendEmail({
        to: recipient,
        subject,
        html,
        text,
        replyTo: request.requesterEmail,
        templateId: CORE_ACCESS_REQUESTED_EMAIL_ID,
        idempotencyKey: `${key}:${recipient}`,
      });
      delivery.email++;
    } catch (err) {
      delivery.failed++;
      console.error("[access-requests] request email failed:", err);
    }
  }
  return delivery;
}

export type RequestResourceAccessResult =
  | { state: "allowed" }
  | { state: "requested"; request: ViewerAccessRequest; sent: boolean };

/**
 * Asks the owner, and anyone with admin, to give the signed-in viewer access
 * to a resource they can't open. Asking again while a request is open sends
 * nothing. If the request is over a daily limit, or nobody could be told,
 * it is withdrawn and this fails, so the viewer never sees "sent" for a
 * request nobody will find.
 */
export async function requestResourceAccess(input: {
  resourceType: string;
  resourceId: string;
  note?: string;
}): Promise<RequestResourceAccessResult> {
  const reg = requireShareableResource(input.resourceType);
  if (!reg.accessRequests) {
    fail(`${reg.displayName} doesn't take access requests.`, {
      errorCode: "access_requests_unsupported",
    });
  }
  const requesterEmail = requireSignedIn("Sign in to request access.");
  const status = await resolveAccessStatus(
    input.resourceType,
    input.resourceId,
  );
  if (status.state === "allowed" || status.state === "trashed") {
    return { state: "allowed" };
  }
  if (status.state !== "denied") {
    fail(`This ${reg.displayName.toLowerCase()} doesn't exist.`, {
      errorCode: "resource_missing",
      statusCode: 404,
    });
  }

  const now = Date.now();
  const existing = openRequestFor(
    await findAccessRequest(
      input.resourceType,
      input.resourceId,
      requesterEmail,
    ),
    now,
  );
  if (existing) return { state: "requested", request: existing, sent: false };

  const resource = await loadResource(reg, input.resourceId);
  const ownerEmail = String(resource?.ownerEmail ?? "")
    .trim()
    .toLowerCase();
  if (!resource || !ownerEmail) {
    fail(`This ${reg.displayName.toLowerCase()} doesn't exist.`, {
      errorCode: "resource_missing",
      statusCode: 404,
    });
  }

  const profile = await getUserProfile(requesterEmail);
  const note = input.note?.trim().slice(0, ACCESS_REQUEST_NOTE_MAX_LENGTH);
  const { request, opened } = await openAccessRequest({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requesterEmail,
    requesterName: profile.name?.trim() || null,
    ownerEmail,
    note: note || null,
    now,
    declinedCooldownStart: now - ACCESS_REQUEST_DECLINE_COOLDOWN_MS,
  });
  const view = openRequestFor(request, now);
  if (!opened || !view) {
    if (view) return { state: "requested", request: view, sent: false };
    fail("This request changed while it was being sent. Try again.", {
      errorCode: "access_request_conflict",
      statusCode: 409,
    });
  }

  // The limits count the request just opened, so requests made at the same
  // moment can't all pass a count taken before any of them existed.
  let delivery: AccessRequestDelivery;
  try {
    await enforceRequestLimits(requesterEmail, ownerEmail, now);
    delivery = await deliverAccessRequest(reg, resource, request);
    if (delivery.inbox + delivery.email === 0) {
      fail("The owner couldn't be notified. Try again in a moment.", {
        errorCode: "access_request_undelivered",
        statusCode: 503,
      });
    }
  } catch (err) {
    await deleteAccessRequest(request.id, request.generation);
    throw err;
  }
  await recordAccessRequestDelivery(request.id, request.generation, {
    ...delivery,
  });
  return { state: "requested", request: view, sent: true };
}

export interface AccessRequestReview {
  id: string;
  generation: number;
  state: AccessRequestRow["state"];
  requester: { email: string; name: string | null };
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  grantedRole: ShareRole | null;
  resource: {
    type: string;
    id: string;
    label: string;
    title: string;
    path: string | null;
  };
}

// Someone who can't manage the resource learns nothing from a request id,
// not even that it exists.
function requestNotFound(): never {
  fail("This request doesn't exist, or you can't manage access to it.", {
    errorCode: "access_request_not_found",
    statusCode: 404,
  });
}

async function loadReviewableRequest(requestId: string): Promise<{
  request: AccessRequestRow;
  reg: ShareableResourceRegistration;
  resource: any;
}> {
  requireSignedIn("Sign in to review access requests.");
  const request = await getAccessRequest(requestId);
  if (!request) requestNotFound();
  const access = await resolveAccess(request.resourceType, request.resourceId);
  if (access?.role !== "owner" && access?.role !== "admin") requestNotFound();
  return {
    request,
    reg: requireShareableResource(request.resourceType),
    resource: access.resource,
  };
}

function toReview(
  reg: ShareableResourceRegistration,
  resource: any,
  request: AccessRequestRow,
): AccessRequestReview {
  return {
    id: request.id,
    generation: request.generation,
    state: request.state,
    requester: { email: request.requesterEmail, name: request.requesterName },
    note: request.note,
    requestedAt: iso(request.requestedAt),
    decidedAt: request.decidedAt === null ? null : iso(request.decidedAt),
    grantedRole: request.grantedRole,
    resource: {
      type: request.resourceType,
      id: request.resourceId,
      label: reg.displayName,
      title: resourceTitle(reg, resource),
      path: resourcePath(reg, resource) ?? null,
    },
  };
}

/** A request, for someone who manages access to its resource. */
export async function getAccessRequestReview(
  requestId: string,
): Promise<AccessRequestReview> {
  const { request, reg, resource } = await loadReviewableRequest(requestId);
  return toReview(reg, resource, request);
}

export interface ResourceAccessRequestList {
  /** The newest pending requests. */
  requests: AccessRequestReview[];
  /** Older pending requests exist beyond `requests`. */
  hasMore: boolean;
}

/** Pending requests for one resource, for someone who manages its access. */
export async function listResourceAccessRequests(
  resourceType: string,
  resourceId: string,
): Promise<ResourceAccessRequestList> {
  const reg = requireShareableResource(resourceType);
  const access = await resolveAccess(resourceType, resourceId, undefined, {
    skipResourceBody: true,
  });
  if (access?.role !== "owner" && access?.role !== "admin") {
    fail(`You can't manage access to this ${reg.displayName.toLowerCase()}.`, {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
  if (!reg.accessRequests) return { requests: [], hasMore: false };
  const rows = await listPendingAccessRequests(
    resourceType,
    resourceId,
    PENDING_LIST_LIMIT + 1,
  );
  return {
    requests: rows
      .slice(0, PENDING_LIST_LIMIT)
      .map((row) => toReview(reg, access.resource, row)),
    hasMore: rows.length > PENDING_LIST_LIMIT,
  };
}

function staleRequest(): never {
  fail("Someone already handled this request, or it changed. Reload it.", {
    errorCode: "access_request_stale",
    statusCode: 409,
  });
}

/**
 * Whether the requester was emailed that they're in: `skipped` when the app
 * has no email set up, `failed` when sending did.
 */
export type AccessGrantedEmail = "sent" | "skipped" | "failed";

async function sendAccessGrantedEmail(
  reg: ShareableResourceRegistration,
  resource: any,
  request: AccessRequestRow,
  approverEmail: string,
  role: ShareRole,
): Promise<AccessGrantedEmail> {
  try {
    if (isSyntheticQaEmail(request.requesterEmail)) return "skipped";
    if (!(await isEmailConfigured())) return "skipped";
    const approver = await getUserProfile(approverEmail);
    const { subject, html, text } = await renderTransactionalEmail(
      CORE_ACCESS_GRANTED_EMAIL_ID,
      {
        recipientEmail: request.requesterEmail,
        approver: {
          name: approver.name?.trim() || approverEmail,
          email: approverEmail,
        },
        resource: {
          type: request.resourceType,
          label: reg.displayName,
          title: resourceTitle(reg, resource),
          url: resolveShareNotificationUrl(
            undefined,
            resourcePath(reg, resource),
            getAppProductionUrl(),
          ),
        },
        role,
        app: await emailBrand(reg, resource),
      },
    );
    await sendEmail({
      to: request.requesterEmail,
      subject,
      html,
      text,
      templateId: CORE_ACCESS_GRANTED_EMAIL_ID,
      idempotencyKey: `access-granted:${request.id}:${request.generation}`,
    });
    return "sent";
  } catch (err) {
    console.error("[access-requests] access-granted email failed:", err);
    return "failed";
  }
}

/**
 * Gives the requester `role`, through the same grant and sharing rules as
 * Share, and closes the request in the same transaction. A stronger role the
 * requester already holds is kept. The access stands even when the email
 * telling them fails; `email` says so.
 */
export async function approveAccessRequest(input: {
  requestId: string;
  generation: number;
  role: ShareRole;
}): Promise<{
  state: "approved";
  role: ShareRole;
  email: AccessGrantedEmail;
}> {
  const { request, reg, resource } = await loadReviewableRequest(
    input.requestId,
  );
  if (request.state !== "pending" || request.generation !== input.generation) {
    staleRequest();
  }
  const approver = viewerEmail()!;
  const exec = getDbExec();
  const grant = await exec.transaction!((tx) =>
    withDbExec(tx, async () => {
      const granted = await grantResourceAccess({
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        principalType: "user",
        principalId: request.requesterEmail,
        role: input.role,
        keepStrongerRole: true,
      });
      const decided = await decideAccessRequest(
        {
          id: request.id,
          generation: request.generation,
          state: "approved",
          decidedBy: approver,
          grantedRole: granted.role,
          now: Date.now(),
        },
        tx,
      );
      if (!decided) staleRequest();
      return granted;
    }),
  );
  await announceResourceAccessChange(
    request.resourceType,
    request.resourceId,
    grant.extensionTargetsBefore,
  );
  const email = await sendAccessGrantedEmail(
    reg,
    resource,
    request,
    approver,
    grant.role,
  );
  return { state: "approved", role: grant.role, email };
}

/** Closes a request without granting anything or telling the requester. */
export async function declineAccessRequest(input: {
  requestId: string;
  generation: number;
}): Promise<{ state: "declined" }> {
  const { request } = await loadReviewableRequest(input.requestId);
  if (request.state !== "pending" || request.generation !== input.generation) {
    staleRequest();
  }
  const decided = await decideAccessRequest({
    id: request.id,
    generation: request.generation,
    state: "declined",
    decidedBy: viewerEmail()!,
    grantedRole: null,
    now: Date.now(),
  });
  if (!decided) staleRequest();
  return { state: "declined" };
}
