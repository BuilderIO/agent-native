import { getDbExec } from "../db/client.js";
import { upsertVerifiedIntegrationIdentity } from "./identity-links-store.js";
import {
  getActiveIntegrationInstallationByKey,
  getActiveIntegrationInstallationForTenant,
} from "./installations-store.js";
import { slackInstallationKey } from "./slack-oauth.js";
import type { IncomingMessage, IntegrationExecutionContext } from "./types.js";

/**
 * Thrown when the default Slack DM identity ladder declines to run a message.
 * `userFacingMessage` is safe to send back to the sender as a polite reply;
 * `message` stays log-only.
 */
export class IntegrationIdentityDeclinedError extends Error {
  readonly userFacingMessage: string;

  constructor(message: string, userFacingMessage: string) {
    super(message);
    this.name = "IntegrationIdentityDeclinedError";
    this.userFacingMessage = userFacingMessage;
  }
}

function serviceOwner(platform: string): string {
  return `integration@${platform}`;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) return null;
  return email;
}

async function resolveSlackInstallation(incoming: IncomingMessage) {
  const teamId =
    typeof incoming.platformContext.teamId === "string"
      ? incoming.platformContext.teamId
      : incoming.tenantId;
  const enterpriseId =
    typeof incoming.platformContext.enterpriseId === "string"
      ? incoming.platformContext.enterpriseId
      : undefined;
  const apiAppId =
    typeof incoming.platformContext.apiAppId === "string"
      ? incoming.platformContext.apiAppId
      : undefined;
  if (apiAppId && (teamId || enterpriseId)) {
    const byKey = await getActiveIntegrationInstallationByKey(
      "slack",
      slackInstallationKey({ teamId, enterpriseId, apiAppId }),
    );
    if (byKey) return byKey;
  }
  return teamId || enterpriseId
    ? getActiveIntegrationInstallationForTenant(
        "slack",
        teamId ?? enterpriseId!,
      )
    : null;
}

async function isMemberOfOrg(email: string, orgId: string): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT 1 FROM org_members
        WHERE org_id = ? AND LOWER(email) = ?
        LIMIT 1`,
    args: [orgId, email],
  });
  return rows.length > 0;
}

/**
 * Resolve the default integration principal.
 *
 * Slack DMs become a user principal only after the adapter has verified the
 * sender email and the email is already a member of the managed installation's
 * Agent Native organization. Hydrated full workspace members whose email is
 * missing, unverified, or not an organization member run as an anonymous
 * org-scoped service principal instead — the same visibility shared channels
 * get. Hydration failures, guests/external members, and workspaces without a
 * connected organization are declined with a user-facing message. Shared
 * channels deliberately stay service-scoped so a channel message cannot borrow
 * one participant's private permissions.
 */
export async function resolveDefaultIntegrationExecutionContext(
  incoming: IncomingMessage,
): Promise<IntegrationExecutionContext> {
  const installation =
    incoming.platform === "slack"
      ? await resolveSlackInstallation(incoming)
      : null;

  if (incoming.platform !== "slack" || incoming.conversationType !== "dm") {
    return {
      ownerEmail: serviceOwner(incoming.platform),
      orgId: installation?.orgId ?? null,
      principalType: "service",
      ...(installation?.id ? { installationId: installation.id } : {}),
    };
  }

  // Hydration check first: a transient users.info failure must land on the
  // retry decline here, never on the anonymous org-scoped tier below.
  if (incoming.actorTrust?.verified !== true) {
    throw new IntegrationIdentityDeclinedError(
      "Slack DM sender identity could not be hydrated; declining instead of guessing a principal.",
      "I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.",
    );
  }
  if (
    incoming.actorTrust.memberType === "guest" ||
    incoming.actorTrust.memberType === "external"
  ) {
    throw new IntegrationIdentityDeclinedError(
      "External or guest Slack members cannot use this integration.",
      "This assistant is only available to members of this workspace's organization.",
    );
  }
  if (!installation?.orgId) {
    throw new IntegrationIdentityDeclinedError(
      "Slack workspace is not connected to an Agent Native organization.",
      "This Slack workspace isn't connected to an organization yet.",
    );
  }

  const email = normalizedEmail(incoming.senderEmail);
  let isOrgMember = false;
  if (
    email &&
    incoming.senderVerified === true &&
    incoming.senderId &&
    incoming.tenantId
  ) {
    try {
      isOrgMember = await isMemberOfOrg(email, installation.orgId);
    } catch {
      // A membership-store outage is not evidence that the sender is merely
      // unlinked. Fail closed instead of widening them to org-wide access.
      throw new IntegrationIdentityDeclinedError(
        "Slack DM organization membership could not be verified.",
        "I couldn't verify your organization membership just now, so I can't run this request. Please try again in a moment.",
      );
    }
  }
  if (isOrgMember && email && incoming.senderId && incoming.tenantId) {
    const link = await upsertVerifiedIntegrationIdentity({
      platform: incoming.platform,
      tenantId: incoming.tenantId,
      externalUserId: incoming.senderId,
      userEmail: email,
      orgId: installation.orgId,
    });
    return {
      ownerEmail: link.userEmail,
      orgId: link.orgId,
      principalType: "user",
      installationId: installation.id,
    };
  }

  // Hydrated full workspace member (member/admin/owner) whose email is
  // unverified, missing (legacy install without users:read.email), or not an
  // organization member: run with the anonymous org-scoped service principal —
  // the same visibility shared channels get. Nothing user-private is
  // accessible. One structured line keeps 100%-anonymous workspaces (legacy
  // scope missing) visible in logs.
  console.warn(
    `[integrations] anonymous org-scoped principal used: platform=${incoming.platform} teamId=${incoming.tenantId ?? "unknown"} emailPresent=${Boolean(email)} memberType=${incoming.actorTrust.memberType}`,
  );
  return {
    ownerEmail: serviceOwner(incoming.platform),
    orgId: installation.orgId,
    principalType: "service",
    installationId: installation.id,
    anonymousMember: true,
  };
}
