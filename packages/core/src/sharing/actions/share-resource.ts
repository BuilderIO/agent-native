import { createHash } from "node:crypto";

import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec, isPostgres } from "../../db/client.js";
import { ensureTableExists } from "../../db/ddl-guard.js";
import { getAppProductionUrl } from "../../server/app-url.js";
import { renderEmail } from "../../server/email-template.js";
import { sendEmail, isEmailConfigured } from "../../server/email.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { assertAccess, ForbiddenError } from "../access.js";
import {
  requireShareableResource,
  type ShareableResourceRegistration,
} from "../registry.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

// A re-share of an email that already has access re-sends the "shared with
// you" email only if the last one went out more than this long ago. Inside
// the window we just tell the sharer it was already sent, rather than
// spamming the recipient's inbox every time someone hits "Add".
const RE_INVITE_THROTTLE_MS = 10 * 60 * 1000;

/**
 * A 4xx `statusCode` marks an error as safe to show verbatim in the client
 * toast (see `server/action-routes.js`'s `isUserFacing` check) — anything
 * without one gets masked as "Internal server error" to avoid leaking
 * internals. This is a normal, expected condition, not a bug, so it gets a
 * real status instead of falling through to that mask.
 */
class RecentlyNotifiedError extends Error {
  statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "RecentlyNotifiedError";
  }
}

const SHARE_NOTIFICATIONS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS share_notifications (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id, principal_id)
)`;

let shareNotificationsTableReady: Promise<void> | null = null;

/**
 * Small standalone table (not part of any template's Drizzle schema) that
 * tracks the last time a "shared with you" email went out for a given
 * (resourceType, resourceId, principalId) tuple. Kept separate from the
 * per-template shares table so re-invite throttling doesn't require every
 * template that uses `createSharesTable()` to carry an extra column.
 */
async function ensureShareNotificationsTable(): Promise<void> {
  if (!shareNotificationsTableReady) {
    shareNotificationsTableReady = (async () => {
      if (isPostgres()) {
        await ensureTableExists(
          "share_notifications",
          SHARE_NOTIFICATIONS_CREATE_SQL,
        );
      } else {
        await getDbExec().execute(SHARE_NOTIFICATIONS_CREATE_SQL);
      }
    })();
  }
  return shareNotificationsTableReady;
}

async function getLastShareNotifiedAt(
  resourceType: string,
  resourceId: string,
  principalId: string,
): Promise<string | null> {
  await ensureShareNotificationsTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT notified_at FROM share_notifications WHERE resource_type = ? AND resource_id = ? AND principal_id = ?`,
    args: [resourceType, resourceId, principalId],
  });
  const row = rows[0] as { notified_at?: string } | undefined;
  return row?.notified_at ?? null;
}

async function recordShareNotification(
  resourceType: string,
  resourceId: string,
  principalId: string,
): Promise<void> {
  await ensureShareNotificationsTable();
  const client = getDbExec();
  const notifiedAt = new Date().toISOString();
  await client.execute({
    sql: `DELETE FROM share_notifications WHERE resource_type = ? AND resource_id = ? AND principal_id = ?`,
    args: [resourceType, resourceId, principalId],
  });
  await client.execute({
    sql: `INSERT INTO share_notifications (resource_type, resource_id, principal_id, notified_at) VALUES (?, ?, ?, ?)`,
    args: [resourceType, resourceId, principalId, notifiedAt],
  });
}

export function isSyntheticQaEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return (
    local.includes("+qa") &&
    (domain === "example.test" ||
      domain.endsWith(".test") ||
      domain === "example.invalid" ||
      domain.endsWith(".invalid"))
  );
}

const USER_PROFILE_LOOKUP_SQL =
  'SELECT name, image FROM "user" WHERE lower(email) = ?';

async function getUserProfileByEmail(
  email: string,
): Promise<{ name: string | null; image: string | null }> {
  try {
    const { rows } = await getDbExec().execute({
      sql: USER_PROFILE_LOOKUP_SQL,
      args: [email.trim().toLowerCase()],
    });
    const row = rows[0] as { name?: string; image?: string } | undefined;
    return {
      name: row?.name?.trim() || null,
      image: row?.image?.trim() || null,
    };
  } catch {
    return { name: null, image: null };
  }
}

/**
 * Overrides only the display name on a `"Name <addr@example.com>"` from
 * string, keeping the verified email address untouched. Returns undefined
 * when there's no base from-address to override (the caller then falls back
 * to the global default, which we can't safely rewrite without knowing its
 * address).
 */
function withSenderDisplayName(
  fromAddress: string | undefined,
  displayName: string,
): string | undefined {
  if (!fromAddress) return undefined;
  const match = fromAddress.match(/<([^>]+)>/);
  const email = match ? match[1] : fromAddress;
  return `"${displayName.replace(/"/g, "'")}" <${email}>`;
}

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!base) return path;
  const normalizedBase = `/${base}`;
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) {
    return path;
  }
  return `${normalizedBase}${path}`;
}

function safeNotificationUrl(value: string, appUrl: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const base = new URL(appUrl);
    if (trimmed.startsWith("/")) {
      const path = appPath(trimmed);
      const basePath = base.pathname.replace(/\/+$/, "");
      const alreadyIncludesBase =
        basePath && basePath !== "/" && path.startsWith(`${basePath}/`);
      const joined = alreadyIncludesBase
        ? `${base.origin}${path}`
        : `${appUrl.replace(/\/+$/, "")}${path}`;
      return new URL(joined).toString();
    }

    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.origin !== base.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveShareNotificationUrl(
  explicitUrl: string | undefined,
  fallbackPath: string | undefined,
  appUrl = getAppProductionUrl(),
): string {
  for (const candidate of [explicitUrl, fallbackPath]) {
    if (!candidate) continue;
    const url = safeNotificationUrl(candidate, appUrl);
    if (url) return url;
  }
  return appUrl;
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function normalizePrincipalId(
  principalType: "user" | "org",
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

function isEmailPrincipalId(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function shareNotificationMessageId(
  resourceType: string,
  resourceId: string,
  principalId: string,
): string {
  const domain = "agent-native.com";
  return (
    "<share-" +
    resourceType +
    "-" +
    resourceId +
    "-" +
    shortHash(principalId) +
    "@" +
    domain +
    ">"
  );
}

function principalIdMatches(
  sharesTable: any,
  principalType: "user" | "org",
  principalId: string,
): SQL {
  return principalType === "user"
    ? sql`lower(${sharesTable.principalId}) = ${principalId}`
    : eq(sharesTable.principalId, principalId);
}

/**
 * Returns true if the given email is either an active member of `orgId` or
 * has a pending invitation to `orgId`. Used by resources whose registration
 * sets `requireOrgMemberForUserShares` (currently extensions) to refuse
 * cross-org user shares.
 *
 * Both `org_members` and `org_invitations` store email case-insensitively
 * via `LOWER()` in the rest of the framework, so we follow the same
 * convention here.
 */
async function isOrgMemberOrInvited(
  orgId: string,
  email: string,
): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  if (!lower || !orgId) return false;
  const client = getDbExec();
  const member = await client.execute({
    sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, lower],
  });
  if (member.rows.length > 0) return true;
  const invited = await client.execute({
    sql: `SELECT 1 FROM org_invitations WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending' LIMIT 1`,
    args: [orgId, lower],
  });
  return invited.rows.length > 0;
}

/**
 * Sends the "shared with you" notification email and records the send in
 * `share_notifications` on success or failure alike (a bad email shouldn't
 * undo the share grant itself, and either way the throttle clock resets).
 */
async function sendShareNotificationEmail(params: {
  db: any;
  reg: ShareableResourceRegistration;
  resourceType: string;
  resourceId: string;
  resourceUrlOverride: string | undefined;
  actor: string;
  principalId: string;
}): Promise<void> {
  const {
    db,
    reg,
    resourceType,
    resourceId,
    resourceUrlOverride,
    actor,
    principalId,
  } = params;
  try {
    const titleCol = reg.titleColumn ?? "title";
    const [resource] = await db
      .select()
      .from(reg.resourceTable)
      .where(eq(reg.resourceTable.id, resourceId));
    const resourceTitle: string =
      (resource?.[titleCol] as string | undefined) ?? resourceType;
    const appUrl = getAppProductionUrl();
    const resourcePath =
      resource && reg.getResourcePath
        ? reg.getResourcePath(resource)
        : undefined;
    const notificationUrl = resolveShareNotificationUrl(
      resourceUrlOverride,
      resourcePath,
      appUrl,
    );
    const appName =
      process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent Native";
    const actorProfile = await getUserProfileByEmail(actor);
    const actorDisplayName = actorProfile.name || actor;
    const senderDisplayName = actorProfile.name
      ? `${actorProfile.name} (via ${reg.logoLabel ?? appName})`
      : reg.logoLabel
        ? `Agent-Native ${reg.logoLabel}`
        : appName;
    const fromAddress = withSenderDisplayName(
      reg.fromAddress,
      senderDisplayName,
    );
    const subject = `${actorDisplayName} shared "${resourceTitle}" with you on ${appName}`;
    const imageUrl = resource ? reg.getThumbnailUrl?.(resource) : undefined;
    const logoUrl = reg.logoPath
      ? new URL(appPath(reg.logoPath), appUrl).toString()
      : undefined;
    const secondaryCta = resource
      ? await reg.getSecondaryCta?.(resource, {
          recipientEmail: principalId,
        })
      : undefined;
    const preheader = resource
      ? ((await reg.getPreheader?.(resource)) ?? subject)
      : subject;
    const messageId = shareNotificationMessageId(
      resourceType,
      resourceId,
      principalId,
    );
    const { html, text } = renderEmail({
      preheader,
      logoUrl,
      logoLabel: reg.logoLabel,
      imageUrl,
      heading: `${actorDisplayName} shared "${resourceTitle}" with you`,
      paragraphs: [],
      cta: { label: `Open ${reg.displayName}`, url: notificationUrl },
      secondaryCta,
      linkCallout: secondaryCta
        ? {
            note: "Copy and paste this link for your own AI agent to summarize:",
            url: notificationUrl,
          }
        : undefined,
      tagline: secondaryCta?.tagline,
      footer: `Just reply to this email if you want to get back to ${actorDisplayName} directly.`,
    });
    await sendEmail({
      to: principalId,
      subject,
      html,
      text,
      from: fromAddress ?? reg.fromAddress,
      replyTo: actor,
      messageId,
    });
  } catch (err) {
    console.error(
      "[share-resource] failed to send share notification:",
      err,
    );
  } finally {
    await recordShareNotification(resourceType, resourceId, principalId);
  }
}

export default defineAction({
  description:
    "Grant a user or org access to a shareable resource. Owner or admin role required.",
  // (audit H5) Sharing-grant operations are admin-tier and let a caller
  // expand who can read/write a resource. Refuse from the tools iframe
  // bridge so a malicious shared tool can't silently re-share its
  // viewer's resources to an attacker-controlled email.
  toolCallable: false,
  schema: z.object({
    resourceType: z
      .string()
      .describe("Registered resource type, e.g. 'document', 'form'."),
    resourceId: z.string().describe("Id of the resource to share."),
    principalType: z
      .enum(["user", "org"])
      .describe("'user' for an individual, 'org' for a whole organization."),
    principalId: z
      .string()
      .describe("Email (user) or org id (org) of the principal."),
    role: z
      .enum(["viewer", "editor", "admin"])
      .default("viewer")
      .describe("Role to grant."),
    notify: z
      .boolean()
      .default(true)
      .describe(
        "Whether to email the user about a new individual share. Defaults to true.",
      ),
    resourceUrl: z
      .string()
      .optional()
      .describe(
        "Optional app-relative or same-origin URL recipients should open. External origins are ignored.",
      ),
  }),
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    const access = await assertAccess(
      args.resourceType,
      args.resourceId,
      "admin",
    );
    const actor = getRequestUserEmail();
    if (!actor) throw new ForbiddenError("Not signed in");
    const principalId = normalizePrincipalId(
      args.principalType,
      args.principalId,
    );
    if (args.principalType === "user" && !isEmailPrincipalId(principalId)) {
      throw new Error(
        "User shares must use an email address, not an internal user id.",
      );
    }
    const beforeExtensionTargets = await getExtensionShareChangeTargets(
      args.resourceType,
      args.resourceId,
    );

    if (reg.requireOrgMemberForUserShares) {
      const resourceOrgId = access.resource?.orgId as string | undefined | null;
      if (!resourceOrgId) {
        throw new ForbiddenError(
          `${reg.displayName} can only be shared from within an organization. Create or join an organization first.`,
        );
      }
      if (args.principalType === "user") {
        const ok = await isOrgMemberOrInvited(resourceOrgId, principalId);
        if (!ok) {
          throw new ForbiddenError(
            `${principalId} is not in your organization. Invite them to the organization first, then share.`,
          );
        }
      } else if (args.principalType === "org") {
        // Cross-org org shares would let an outside org's members run
        // extension code in the viewer's auth context — the same threat
        // model that blocks public + cross-org user shares. Pin org-
        // principal shares to the resource's own org.
        if (principalId !== resourceOrgId) {
          throw new ForbiddenError(
            `${reg.displayName} can only be shared with its own organization, not a different one.`,
          );
        }
      }
    }

    const db = reg.getDb() as any;
    const [existing] = await db
      .select()
      .from(reg.sharesTable)
      .where(
        and(
          eq(reg.sharesTable.resourceId, args.resourceId),
          eq(reg.sharesTable.principalType, args.principalType),
          principalIdMatches(reg.sharesTable, args.principalType, principalId),
        ),
      );

    const notifyRequested =
      args.notify !== false &&
      args.principalType === "user" &&
      !isSyntheticQaEmail(principalId);

    if (existing) {
      if (notifyRequested) {
        const lastNotifiedAt = await getLastShareNotifiedAt(
          args.resourceType,
          args.resourceId,
          principalId,
        );
        if (lastNotifiedAt) {
          const elapsedMs = Date.now() - new Date(lastNotifiedAt).getTime();
          if (elapsedMs < RE_INVITE_THROTTLE_MS) {
            const minutesAgo = Math.max(1, Math.round(elapsedMs / 60_000));
            throw new RecentlyNotifiedError(
              `${principalId} already got an invite for this ${reg.displayName.toLowerCase()} ${
                minutesAgo === 1 ? "a minute" : `${minutesAgo} minutes`
              } ago. Give it a little longer before resending.`,
            );
          }
        }
      }

      await db
        .update(reg.sharesTable)
        .set({ role: args.role })
        .where(eq(reg.sharesTable.id, existing.id));
      invalidateCollabAccessCache(args.resourceType, args.resourceId);
      await notifyExtensionShareChanged(
        args.resourceType,
        args.resourceId,
        beforeExtensionTargets,
      );

      if (notifyRequested && (await isEmailConfigured())) {
        await sendShareNotificationEmail({
          db,
          reg,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          resourceUrlOverride: args.resourceUrl,
          actor,
          principalId,
        });
      }

      return { id: existing.id, updated: true };
    }

    const id = nanoid();
    await db.insert(reg.sharesTable).values({
      id,
      resourceId: args.resourceId,
      principalType: args.principalType,
      principalId,
      role: args.role,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    });
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );

    if (notifyRequested && (await isEmailConfigured())) {
      await sendShareNotificationEmail({
        db,
        reg,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        resourceUrlOverride: args.resourceUrl,
        actor,
        principalId,
      });
    }

    return { id, updated: false };
  },
});
