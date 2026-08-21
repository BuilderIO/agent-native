import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { getAppProductionUrl } from "../../server/app-url.js";
import {
  emailQuote,
  emailStrong,
  renderEmail,
} from "../../server/email-template.js";
import { sendEmail, isEmailConfigured } from "../../server/email.js";
import { invalidateCollabAccessCache } from "../../server/poll.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { getUserProfile } from "../../user-profile/store.js";
import { assertWorkspaceUserGroupIds } from "../../workspace-connections/groups.js";
import { assertAccess, ForbiddenError } from "../access.js";
import { requireShareableResource } from "../registry.js";
import type { ShareEmailExtras } from "../registry.js";
import {
  getExtensionShareChangeTargets,
  notifyExtensionShareChanged,
} from "./extension-change.js";

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
  principalType: "user" | "group" | "org",
  principalId: string,
): string {
  return principalType === "user"
    ? principalId.trim().toLowerCase()
    : principalId;
}

function isEmailPrincipalId(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

function principalIdMatches(
  sharesTable: any,
  principalType: "user" | "group" | "org",
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

export default defineAction({
  description:
    "Grant a user, group, or org access to a shareable resource. Owner or admin role required.",
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
      .enum(["user", "group", "org"])
      .describe(
        "'user' for an individual, 'group' for an organization group, or 'org' for the whole organization.",
      ),
    principalId: z
      .string()
      .describe(
        "Email (user), group id (group), or org id (org) of the principal.",
      ),
    role: z
      .enum(["viewer", "commenter", "editor", "admin"])
      .default("viewer")
      .describe(
        "Role to grant: viewer can only read; commenter can read and add comments; editor can edit; admin can edit and manage access.",
      ),
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
    message: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe(
        "Optional short note included in the notification email to an individual recipient.",
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
    if (args.principalType === "group" && reg.supportsGroupShares !== true) {
      throw new ForbiddenError(
        `${reg.displayName} does not support organization groups yet.`,
      );
    }
    if (args.principalType === "user" && !isEmailPrincipalId(principalId)) {
      throw new Error(
        "User shares must use an email address, not an internal user id.",
      );
    }
    if (args.principalType === "group") {
      const resourceOrgId = access.resource?.orgId as string | undefined | null;
      if (!resourceOrgId) {
        throw new ForbiddenError(
          `${reg.displayName} can only be shared with a group from within an organization.`,
        );
      }
      try {
        await assertWorkspaceUserGroupIds([principalId], resourceOrgId);
      } catch {
        throw new ForbiddenError(
          `${reg.displayName} can only be shared with a group from its own organization.`,
        );
      }
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
      } else if (args.principalType === "group") {
        // Group ownership was validated above against the resource org.
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

    if (existing) {
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
      return { id: existing.id, updated: true };
    }

    const id = nanoid();
    const [inserted] = await db
      .insert(reg.sharesTable)
      .values({
        id,
        resourceId: args.resourceId,
        principalType: args.principalType,
        principalId,
        role: args.role,
        createdBy: actor,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: reg.sharesTable.id });
    if (!inserted) {
      const [existingAfterConflict] = await db
        .select()
        .from(reg.sharesTable)
        .where(
          and(
            eq(reg.sharesTable.resourceId, args.resourceId),
            eq(reg.sharesTable.principalType, args.principalType),
            principalIdMatches(
              reg.sharesTable,
              args.principalType,
              principalId,
            ),
          ),
        );
      if (!existingAfterConflict) {
        throw new Error("Share conflict could not be resolved.");
      }
      await db
        .update(reg.sharesTable)
        .set({ role: args.role })
        .where(eq(reg.sharesTable.id, existingAfterConflict.id));
      invalidateCollabAccessCache(args.resourceType, args.resourceId);
      await notifyExtensionShareChanged(
        args.resourceType,
        args.resourceId,
        beforeExtensionTargets,
      );
      return { id: existingAfterConflict.id, updated: true };
    }
    invalidateCollabAccessCache(args.resourceType, args.resourceId);
    await notifyExtensionShareChanged(
      args.resourceType,
      args.resourceId,
      beforeExtensionTargets,
    );

    if (
      args.notify !== false &&
      args.principalType === "user" &&
      (await isEmailConfigured()) &&
      !isSyntheticQaEmail(principalId)
    ) {
      try {
        const titleCol = reg.titleColumn ?? "title";
        const [resource] = await db
          .select()
          .from(reg.resourceTable)
          .where(eq(reg.resourceTable.id, args.resourceId));
        const resourceTitle: string =
          (resource?.[titleCol] as string | undefined) ?? args.resourceType;
        const appUrl = getAppProductionUrl();
        const resourcePath =
          resource && reg.getResourcePath
            ? reg.getResourcePath(resource)
            : undefined;
        const notificationUrl = resolveShareNotificationUrl(
          args.resourceUrl,
          resourcePath,
          appUrl,
        );
        const appName =
          process.env.APP_NAME || process.env.VITE_APP_NAME || "Agent Native";
        let brandLogoUrl: string | undefined;
        if (reg.getLogoUrl) {
          try {
            brandLogoUrl = (await reg.getLogoUrl(resource)) ?? undefined;
          } catch (err) {
            console.error(
              "[share-resource] brand logo resolver failed; using default logo:",
              err,
            );
          }
        }
        let brandName = appName;
        if (reg.getBrandName) {
          try {
            brandName = (await reg.getBrandName(resource))?.trim() || appName;
          } catch (err) {
            console.error(
              "[share-resource] brand name resolver failed; using app name:",
              err,
            );
          }
        }
        const senderProfile = await getUserProfile(actor);
        const senderDisplayName = senderProfile.name?.trim() || actor;
        let fromName: string | undefined;
        let replyTo: string | undefined;
        if (reg.getSender) {
          try {
            const sender = await reg.getSender(resource, {
              sender: senderProfile,
            });
            fromName = sender?.fromName?.trim() || undefined;
            replyTo = sender?.replyTo?.trim() || undefined;
          } catch (err) {
            console.error(
              "[share-resource] sender resolver failed; using default sender:",
              err,
            );
          }
        }
        let heroHtml: string | undefined;
        if (reg.getHeroHtml) {
          try {
            heroHtml =
              (await reg.getHeroHtml(resource, {
                href: notificationUrl,
                alt: resourceTitle,
              })) ?? undefined;
          } catch (err) {
            console.error(
              "[share-resource] hero html resolver failed; omitting preview:",
              err,
            );
          }
        }
        let extras: ShareEmailExtras | undefined;
        if (reg.getShareEmailExtras) {
          try {
            extras =
              (await reg.getShareEmailExtras(resource, {
                href: notificationUrl,
                sender: senderProfile,
                recipientEmail: principalId,
              })) ?? undefined;
          } catch (err) {
            console.error(
              "[share-resource] share email extras resolver failed; sending the plain notification:",
              err,
            );
          }
        }
        const subject = `${actor} shared "${resourceTitle}" with you on ${appName}`;
        const messageParagraph = args.message?.trim()
          ? emailQuote(args.message)
          : null;
        const defaultParagraphs = [
          `${emailStrong(actor)} has shared the ${reg.displayName} ${emailStrong(resourceTitle)} with you as a ${emailStrong(args.role)}.`,
          ...(messageParagraph ? [messageParagraph] : []),
          `Use the button below to open it. If prompted, sign in with ${emailStrong(principalId)}.`,
        ];
        const { html, text } = renderEmail({
          brandName,
          brandLogoUrl,
          preheader: subject,
          heading: `${senderDisplayName} shared "${resourceTitle}" with you`,
          paragraphs: extras?.paragraphs
            ? messageParagraph
              ? [messageParagraph, ...extras.paragraphs]
              : extras.paragraphs
            : defaultParagraphs,
          heroHtml,
          cta: { label: `Open ${reg.displayName}`, url: notificationUrl },
          secondaryCta: extras?.secondaryCta,
          linkBlock: extras?.linkBlock,
          closingParagraphs: extras?.closingParagraphs,
          footer: `You received this because ${actor} granted you ${args.role} access.`,
        });
        await sendEmail({
          to: principalId,
          subject,
          html,
          text,
          fromName,
          replyTo,
        });
      } catch (err) {
        console.error(
          "[share-resource] failed to send share notification:",
          err,
        );
      }
    }

    return { id, updated: false };
  },
});
