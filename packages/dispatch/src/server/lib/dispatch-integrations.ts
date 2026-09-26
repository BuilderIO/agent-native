import crypto from "node:crypto";

import {
  evaluateIntegrationScopePolicy,
  getActiveIntegrationInstallationByKey,
  getIntegrationScope,
  resolveIntegrationTokenBundle,
  resolveSlackBotTokenForIncoming,
  saveIntegrationScope,
  slackInstallationKey,
} from "@agent-native/core/integrations";
import { isOrgMember, resolveOrgIdForEmail } from "@agent-native/core/org";
import { withConfiguredAppBasePath } from "@agent-native/core/server";
import type {
  IncomingMessage,
  IntegrationExecutionContext,
  PlatformAdapter,
} from "@agent-native/core/server";

import { handleRemoteCodeCommand } from "./dispatch-remote-commands.js";
import {
  dispatchIntegrationRoutingHint,
  type DispatchIntegrationRoutingHint,
} from "./dispatch-routing.js";
import { consumeLinkToken, resolveLinkedOwner } from "./dispatch-store.js";

type SlackSenderProfile = {
  email: string | null;
  name: string | null;
  trust: "trusted" | "guest" | "external_shared" | "unknown";
};

const slackProfileCache = new Map<
  string,
  { profile: SlackSenderProfile; expiresAt: number }
>();
const SLACK_PROFILE_CACHE_TTL = 10 * 60 * 1000;

function contextString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function identityKeyForIncoming(
  incoming: IncomingMessage,
): string | null {
  const senderId = contextString(incoming.senderId);
  if (!senderId) return null;

  if (incoming.platform === "slack") {
    const teamId = contextString(incoming.platformContext.teamId);
    return teamId ? `${teamId}:${senderId}` : senderId;
  }

  if (incoming.platform === "whatsapp") {
    const phoneNumberId = contextString(incoming.platformContext.phoneNumberId);
    return phoneNumberId ? `${phoneNumberId}:${senderId}` : senderId;
  }

  if (incoming.platform === "email") {
    return senderId.toLowerCase();
  }

  return senderId;
}

function fallbackOwnerForIncoming(incoming: IncomingMessage): string {
  const tenant =
    contextString(incoming.platformContext.teamId) ||
    contextString(incoming.platformContext.phoneNumberId) ||
    contextString(incoming.platformContext.chatId) ||
    contextString(incoming.platformContext.from) ||
    incoming.externalThreadId;
  const raw = `${incoming.platform}:${tenant}:${incoming.senderId || ""}`;
  const hash = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  return `dispatch+${hash}@integration.local`;
}

function configuredDefaultOwnerForIncoming(
  incoming: IncomingMessage,
): string | null {
  if (incoming.platform !== "slack") return null;
  const email = process.env.DISPATCH_DEFAULT_OWNER_EMAIL?.trim();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function platformRequiresExplicitLink(incoming: IncomingMessage): boolean {
  return incoming.platform === "telegram";
}

function configuredDispatchIdentitiesUrl(): string | null {
  const raw =
    process.env.WORKSPACE_GATEWAY_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    "";
  if (!raw.trim()) return null;
  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(
      "identities",
      `${withConfiguredAppBasePath(base).replace(/\/+$/, "")}/`,
    ).toString();
  } catch {
    return null;
  }
}

async function resolveManagedSlackInstallation(incoming: IncomingMessage) {
  if (incoming.platform !== "slack") return null;
  const teamId = contextString(incoming.platformContext.teamId);
  const enterpriseId = contextString(incoming.platformContext.enterpriseId);
  const apiAppId = contextString(incoming.platformContext.apiAppId);
  const isEnterpriseInstall =
    incoming.platformContext.isEnterpriseInstall === true;
  if ((!teamId && !enterpriseId) || (isEnterpriseInstall && !enterpriseId))
    return null;
  return getActiveIntegrationInstallationByKey(
    "slack",
    slackInstallationKey({
      teamId,
      enterpriseId,
      apiAppId,
      isEnterpriseInstall,
    }),
  );
}

class ManagedSlackInstallationLookupError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Managed Slack installation identity is temporarily unavailable",
      options,
    );
    this.name = "ManagedSlackInstallationLookupError";
  }
}

async function resolveManagedSlackInstallationOrFail(
  incoming: IncomingMessage,
) {
  try {
    return await resolveManagedSlackInstallation(incoming);
  } catch (cause) {
    throw new ManagedSlackInstallationLookupError({ cause });
  }
}

async function resolveManagedSlackToken(
  incoming: IncomingMessage,
): Promise<string | null> {
  const installation = await resolveManagedSlackInstallation(incoming);
  if (!installation) return null;
  const bundle = await resolveIntegrationTokenBundle(
    "slack",
    installation.installationKey,
  );
  return bundle?.accessToken ?? null;
}

function formatTelegramLinkRequiredMessage(): string {
  const identitiesUrl = configuredDispatchIdentitiesUrl();
  const linkStep = identitiesUrl
    ? `Tap ${identitiesUrl}, create a Telegram link token, then send \`/link <token>\` here.`
    : "Open Dispatch while signed in, create a Telegram link token, then send `/link <token>` here.";
  return `Telegram is connected, but this Telegram account is not linked to an Agent-Native user yet. ${linkStep} After that I can use your Builder.io org and connected apps.`;
}

function formatSlackLinkRequiredMessage(): string {
  const identitiesUrl = configuredDispatchIdentitiesUrl();
  const linkStep = identitiesUrl
    ? `Open ${identitiesUrl}, create a Slack link token, then send \`/link <token>\` in this DM.`
    : "Open Dispatch while signed in, create a Slack link token, then send `/link <token>` in this DM.";
  return `Agent-Native is ready, but this Slack account is not linked to an Agent-Native user yet. ${linkStep}`;
}

function formatSlackIdentityVerificationFailedMessage(): string {
  const identitiesUrl = configuredDispatchIdentitiesUrl();
  const recovery = identitiesUrl
    ? ` If this keeps happening, open ${identitiesUrl} while signed in and link Slack.`
    : " If this keeps happening, open Dispatch while signed in and link Slack from Identities.";
  return `I couldn't verify your Slack identity just now, so I can't run this request. Please try again in a moment.${recovery}`;
}

function formatSlackIdentityDeniedMessage(): string {
  return "This assistant is only available to members of this workspace's organization.";
}

async function resolveSlackSenderProfile(
  incoming: IncomingMessage,
): Promise<SlackSenderProfile> {
  if (incoming.platform !== "slack") {
    return { email: null, name: null, trust: "unknown" };
  }
  const token = await resolveSlackBotTokenForIncoming(incoming);
  const userId = contextString(incoming.senderId);
  const teamId = contextString(incoming.platformContext.teamId);
  if (!token || !userId) {
    return { email: null, name: null, trust: "unknown" };
  }

  const cacheKey = teamId ? `${teamId}:${userId}` : null;
  if (cacheKey) {
    const cached = slackProfileCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;
  }

  try {
    const params = new URLSearchParams({ user: userId });
    const res = await fetch(`https://slack.com/api/users.info?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: {
        real_name?: string;
        name?: string;
        profile?: {
          email?: string;
          real_name?: string;
          display_name?: string;
        };
        is_restricted?: boolean;
        is_ultra_restricted?: boolean;
        is_stranger?: boolean;
      };
    };
    const profile = data.ok
      ? {
          email: data.user?.profile?.email?.trim().toLowerCase() || null,
          name:
            data.user?.profile?.real_name?.trim() ||
            data.user?.profile?.display_name?.trim() ||
            data.user?.real_name?.trim() ||
            data.user?.name?.trim() ||
            null,
          trust:
            data.user?.is_stranger === true ||
            data.user?.is_ultra_restricted === true
              ? ("external_shared" as const)
              : data.user?.is_restricted === true
                ? ("guest" as const)
                : ("trusted" as const),
        }
      : { email: null, name: null, trust: "unknown" as const };
    if (cacheKey) {
      slackProfileCache.set(cacheKey, {
        profile,
        expiresAt: Date.now() + SLACK_PROFILE_CACHE_TTL,
      });
    }
    return profile;
  } catch {
    return { email: null, name: null, trust: "unknown" };
  }
}

async function resolveSlackSenderProfileWithinAckDeadline(
  incoming: IncomingMessage,
): Promise<SlackSenderProfile> {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => resolve({ email: null, name: null, trust: "unknown" }),
      2_000,
    );
    void resolveSlackSenderProfile(incoming).then(
      (profile) => {
        clearTimeout(timeout);
        resolve(profile);
      },
      () => {
        clearTimeout(timeout);
        resolve({ email: null, name: null, trust: "unknown" });
      },
    );
  });
}

async function resolveSlackOwnerFromVerifiedEmail(
  incoming: IncomingMessage,
): Promise<string | null> {
  const profile = await resolveSlackSenderProfileWithinAckDeadline(incoming);
  if (!profile.email) return null;

  incoming.senderEmail = profile.email;
  incoming.platformContext.senderEmail = profile.email;
  if (profile.name) {
    incoming.senderName = profile.name;
    incoming.platformContext.senderName = profile.name;
  }

  const orgId = await resolveOrgIdForEmail(profile.email);
  return orgId ? profile.email : null;
}

async function resolveManagedSlackDmExecutionContext(
  incoming: IncomingMessage,
  installation: NonNullable<
    Awaited<ReturnType<typeof resolveManagedSlackInstallation>>
  >,
): Promise<IntegrationExecutionContext> {
  const profile = await resolveSlackSenderProfileWithinAckDeadline(incoming);
  incoming.actorTrust = {
    memberType:
      profile.trust === "guest"
        ? "guest"
        : profile.trust === "external_shared"
          ? "external"
          : profile.trust === "trusted"
            ? "member"
            : "unknown",
    verified: profile.trust !== "unknown",
  };
  incoming.senderVerified = profile.email !== null;
  if (profile.email) {
    incoming.senderEmail = profile.email;
    incoming.platformContext.senderEmail = profile.email;
  }
  if (profile.name) {
    incoming.senderName = profile.name;
    incoming.platformContext.senderName = profile.name;
  }

  const deniedContext = (): IntegrationExecutionContext => ({
    ownerEmail: fallbackOwnerForIncoming(incoming),
    orgId: null,
    principalType: "user",
    installationId: installation.id,
  });

  if (profile.trust === "unknown") {
    incoming.platformContext.identityVerificationFailed = true;
    return deniedContext();
  }
  if (profile.trust === "guest" || profile.trust === "external_shared") {
    incoming.platformContext.identityAccessDenied = true;
    return deniedContext();
  }
  if (!installation.orgId) {
    incoming.platformContext.identityLinkRequired = true;
    return deniedContext();
  }
  incoming.platformContext.managedInstallationOrgId = installation.orgId;

  let linkedOwner: string | null;
  try {
    linkedOwner = await resolveLinkedOwner(
      "slack",
      identityKeyForIncoming(incoming),
      { orgId: installation.orgId },
    );
  } catch {
    incoming.platformContext.identityVerificationFailed = true;
    return deniedContext();
  }
  const candidates = [profile.email, linkedOwner].filter(
    (email, index, values): email is string =>
      !!email && values.indexOf(email) === index,
  );
  for (const ownerEmail of candidates) {
    try {
      if (await isOrgMember(installation.orgId, ownerEmail)) {
        return {
          ownerEmail,
          orgId: installation.orgId,
          principalType: "user",
          installationId: installation.id,
        };
      }
    } catch {
      incoming.platformContext.identityVerificationFailed = true;
      return deniedContext();
    }
  }

  incoming.platformContext.identityLinkRequired = true;
  return deniedContext();
}

async function resolveSlackConversationTrust(
  incoming: IncomingMessage,
  actorTrust: SlackSenderProfile["trust"],
): Promise<{
  trust: SlackSenderProfile["trust"];
  conversationType: "channel" | "direct_message" | "group_direct_message";
}> {
  if (incoming.triggerKind === "dm") {
    return { trust: actorTrust, conversationType: "direct_message" };
  }
  const token = await resolveManagedSlackToken(incoming);
  const channel = contextString(incoming.platformContext.channelId);
  if (!token || !channel) {
    return { trust: "unknown", conversationType: "channel" };
  }
  try {
    const params = new URLSearchParams({ channel });
    const response = await fetch(
      `https://slack.com/api/conversations.info?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await response.json()) as {
      ok?: boolean;
      channel?: {
        is_ext_shared?: boolean;
        is_im?: boolean;
        is_mpim?: boolean;
      };
    };
    if (!data.ok) {
      return { trust: "unknown", conversationType: "channel" };
    }
    return {
      trust: data.channel?.is_ext_shared ? "external_shared" : actorTrust,
      conversationType: data.channel?.is_im
        ? "direct_message"
        : data.channel?.is_mpim
          ? "group_direct_message"
          : "channel",
    };
  } catch {
    return { trust: "unknown", conversationType: "channel" };
  }
}

export async function resolveDispatchOwner(
  incoming: IncomingMessage,
): Promise<string> {
  try {
    const externalUserId = identityKeyForIncoming(incoming);

    const owner = await resolveLinkedOwner(incoming.platform, externalUserId, {
      allowAnyOrgFallback: true,
    });
    if (owner) return owner;

    // anyone claim any From, and our inbound webhook secret only authenticates
    // Otherwise fall through to the synthetic, credential-less fallback owner.
    if (
      incoming.platform === "email" &&
      incoming.senderId &&
      incoming.senderId.includes("@")
    ) {
      if (process.env.DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER === "1") {
        return incoming.senderId;
      }
      if (incoming.senderVerified) {
        const orgId = await resolveOrgIdForEmail(incoming.senderId);
        if (orgId) return incoming.senderId;
      }
      // Unverified or not an org member — do not impersonate. Fall through to
      // the synthetic fallback owner below.
    }

    if (incoming.platform === "slack") {
      const slackOwner = await resolveSlackOwnerFromVerifiedEmail(incoming);
      if (slackOwner) return slackOwner;
    }

    const defaultOwner = configuredDefaultOwnerForIncoming(incoming);
    if (defaultOwner) return defaultOwner;

    return fallbackOwnerForIncoming(incoming);
  } catch {
    const defaultOwner = configuredDefaultOwnerForIncoming(incoming);
    if (defaultOwner) return defaultOwner;
    return fallbackOwnerForIncoming(incoming);
  }
}

export async function resolveDispatchExecutionContext(
  incoming: IncomingMessage,
): Promise<IntegrationExecutionContext> {
  if (incoming.platform === "slack" && incoming.triggerKind === "dm") {
    let installation;
    try {
      installation = await resolveManagedSlackInstallationOrFail(incoming);
    } catch (error) {
      if (!(error instanceof ManagedSlackInstallationLookupError)) throw error;
      incoming.platformContext.identityVerificationFailed = true;
      return {
        ownerEmail: fallbackOwnerForIncoming(incoming),
        orgId: null,
        principalType: "user",
      };
    }
    if (installation) {
      return resolveManagedSlackDmExecutionContext(incoming, installation);
    }
    const linkedOwner = await resolveLinkedOwner(
      "slack",
      identityKeyForIncoming(incoming),
      { allowAnyOrgFallback: true },
    );
    if (linkedOwner) {
      const orgId = await resolveOrgIdForEmail(linkedOwner);
      return {
        ownerEmail: linkedOwner,
        orgId,
        principalType: "user",
      };
    }
    const verifiedEmail = incoming.senderEmail?.trim().toLowerCase();
    if (
      incoming.actorTrust?.verified === true &&
      incoming.senderVerified === true &&
      verifiedEmail &&
      incoming.actorTrust.memberType !== "guest" &&
      incoming.actorTrust.memberType !== "external"
    ) {
      const orgId = await resolveOrgIdForEmail(verifiedEmail);
      if (orgId) {
        return {
          ownerEmail: verifiedEmail,
          orgId,
          principalType: "user",
        };
      }
      incoming.platformContext.identityLinkRequired = true;
      return {
        ownerEmail: fallbackOwnerForIncoming(incoming),
        orgId: null,
        principalType: "user",
      };
    }
    incoming.platformContext.identityVerificationFailed = true;
    return {
      ownerEmail: fallbackOwnerForIncoming(incoming),
      orgId: null,
      principalType: "user",
    };
  }

  if (incoming.platform !== "slack" || incoming.triggerKind === "dm") {
    const ownerEmail = await resolveDispatchOwner(incoming);
    if (
      incoming.platform === "slack" &&
      ownerEmail.endsWith("@integration.local")
    ) {
      // deliver linking guidance or consume `/link <token>`. Never run the
      incoming.platformContext.identityLinkRequired = true;
    }
    return {
      ownerEmail,
      orgId: (await resolveOrgIdForEmail(ownerEmail)) ?? null,
      principalType: "user",
    };
  }

  const installation = await resolveManagedSlackInstallationOrFail(incoming);
  if (!installation) {
    const ownerEmail = await resolveDispatchOwner(incoming);
    return {
      ownerEmail,
      orgId: (await resolveOrgIdForEmail(ownerEmail)) ?? null,
      principalType: "user",
    };
  }

  const teamId = contextString(incoming.platformContext.teamId);
  const channelId = contextString(incoming.platformContext.channelId);
  if (!teamId || !channelId) {
    throw new Error("Slack channel identity is incomplete");
  }
  const profile = await resolveSlackSenderProfileWithinAckDeadline(incoming);
  const conversation = await resolveSlackConversationTrust(
    incoming,
    profile.trust,
  );
  const access = {
    ownerEmail: installation.ownerEmail,
    orgId: installation.orgId,
  };
  const key = {
    platform: "slack",
    tenantId: teamId,
    conversationId: channelId,
  };
  let scope = await getIntegrationScope(key, access);
  if (!scope && incoming.triggerKind === "mention") {
    scope = await saveIntegrationScope(
      {
        ...key,
        conversationType: conversation.conversationType,
        trust: conversation.trust,
        orgId: installation.orgId,
        installationId: installation.id,
      },
      access,
    );
  }
  if (!scope) throw new Error("Slack channel is not enabled for Agent-Native");
  const decision = evaluateIntegrationScopePolicy(scope, {
    mentioned:
      incoming.triggerKind === "mention" ||
      incoming.triggerKind === "thread_reply",
  });
  if (!decision.allowed) {
    throw new Error(`Slack channel policy denied: ${decision.reason}`);
  }
  incoming.integrationScopeId = scope.id;
  if (scope.defaultModel) {
    incoming.platformContext.defaultModel = scope.defaultModel;
  }
  incoming.actorTrust = {
    memberType:
      conversation.trust === "guest"
        ? "guest"
        : conversation.trust === "external_shared"
          ? "external"
          : conversation.trust === "trusted"
            ? "member"
            : "unknown",
    verified: conversation.trust !== "unknown",
  };
  return {
    ownerEmail: scope.serviceOwnerEmail,
    orgId: scope.orgId,
    principalType: "service",
    installationId: installation.id,
    scopeId: scope.id,
  };
}

export async function beforeDispatchProcess(
  incoming: IncomingMessage,
  adapter: PlatformAdapter,
): Promise<{ handled: true; responseText?: string } | { handled: false }> {
  const trimmed = incoming.text.trim();
  const commandText =
    contextString(incoming.platformContext.rawText) || trimmed;
  const match = commandText.match(/^\/link(?:@\w+)?\s+([a-zA-Z0-9_-]+)$/);
  if (
    match &&
    incoming.platform === "slack" &&
    incoming.triggerKind === "dm" &&
    !contextString(incoming.platformContext.managedInstallationOrgId) &&
    incoming.platformContext.identityVerificationFailed !== true &&
    incoming.platformContext.identityAccessDenied !== true
  ) {
    await resolveDispatchExecutionContext(incoming);
  }
  if (
    incoming.platform === "slack" &&
    incoming.triggerKind === "dm" &&
    incoming.platformContext.identityVerificationFailed === true
  ) {
    return {
      handled: true,
      responseText: formatSlackIdentityVerificationFailedMessage(),
    };
  }
  if (
    incoming.platform === "slack" &&
    incoming.triggerKind === "dm" &&
    incoming.platformContext.identityAccessDenied === true
  ) {
    return {
      handled: true,
      responseText: formatSlackIdentityDeniedMessage(),
    };
  }
  if (!match) {
    const routedIncoming = incoming as IncomingMessage & {
      routingHint?: DispatchIntegrationRoutingHint;
    };
    routedIncoming.routingHint ??= dispatchIntegrationRoutingHint(trimmed);
    if (
      incoming.platform === "slack" &&
      incoming.triggerKind === "dm" &&
      incoming.platformContext.identityLinkRequired === true
    ) {
      return {
        handled: true,
        responseText: formatSlackLinkRequiredMessage(),
      };
    }
    if (platformRequiresExplicitLink(incoming)) {
      const owner = await resolveLinkedOwner(
        incoming.platform,
        identityKeyForIncoming(incoming),
        { allowAnyOrgFallback: true },
      );
      if (!owner) {
        return {
          handled: true,
          responseText: formatTelegramLinkRequiredMessage(),
        };
      }
    }
    return handleRemoteCodeCommand(incoming, adapter, {
      resolveOwner: () => resolveDispatchOwner(incoming),
    });
  }

  try {
    const expectedOrgId = contextString(
      incoming.platformContext.managedInstallationOrgId,
    );
    const owner = await consumeLinkToken({
      platform: incoming.platform,
      token: match[1],
      externalUserId: identityKeyForIncoming(incoming),
      externalUserName: incoming.senderName || null,
      ...(expectedOrgId ? { expectedOrgId } : {}),
    });
    return {
      handled: true,
      responseText: `Linked successfully. Future ${incoming.platform} messages will use ${owner}'s personal dispatch context.`,
    };
  } catch (error) {
    return {
      handled: true,
      responseText:
        error instanceof Error ? error.message : "Failed to link this account.",
    };
  }
}
