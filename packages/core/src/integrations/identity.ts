import { getDbExec } from "../db/client.js";
import { upsertVerifiedIntegrationIdentity } from "./identity-links-store.js";
import {
  getActiveIntegrationInstallationByKey,
  getActiveIntegrationInstallationForTenant,
} from "./installations-store.js";
import { slackInstallationKey } from "./slack-oauth.js";
import type { IncomingMessage, IntegrationExecutionContext } from "./types.js";

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
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT 1 FROM org_members
        WHERE org_id = ? AND LOWER(email) = ?
        LIMIT 1`,
      args: [orgId, email],
    });
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the default integration principal.
 *
 * Slack DMs become a user principal only after the adapter has verified the
 * sender email and the email is already a member of the managed installation's
 * Agent Native organization. Shared channels deliberately stay service-scoped
 * so a channel message cannot borrow one participant's private permissions.
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

  const email = normalizedEmail(incoming.senderEmail);
  if (
    !email ||
    incoming.senderVerified !== true ||
    !incoming.senderId ||
    !incoming.tenantId
  ) {
    throw new Error(
      "Slack DM sender identity could not be verified; refusing to run with a service principal.",
    );
  }
  if (
    incoming.actorTrust?.memberType === "guest" ||
    incoming.actorTrust?.memberType === "external"
  ) {
    throw new Error(
      "External or guest Slack members cannot use personal Agent Native permissions.",
    );
  }
  if (!installation?.orgId) {
    throw new Error(
      "Slack workspace is not connected to an Agent Native organization.",
    );
  }

  if (!(await isMemberOfOrg(email, installation.orgId))) {
    throw new Error(
      "Slack DM sender is not a member of the connected Agent Native organization.",
    );
  }

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
