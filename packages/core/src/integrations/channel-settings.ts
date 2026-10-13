/**
 * Settings › Channels on the server: what each mounted channel needs, where
 * each credential comes from, and the owner/admin operations the page and the
 * agent both run through `list-messaging-channels` and
 * `manage-messaging-channel`.
 *
 * Credentials saved here are workspace-scoped secrets for the organization
 * (or `solo:<email>` without one), which is where `resolveSecret` looks for
 * them both in Settings requests and in webhooks, which run as the admin who
 * turned the channel on. Nothing here depends on a template declaring the
 * keys, so every app can set up every channel it mounts.
 */

import { fail, type ActionRunContext } from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import {
  resolveSecretManagedBy,
  SECRET_MANAGERS,
} from "../secrets/managed-keys.js";
import {
  deleteAppSecret,
  readAppSecrets,
  writeAppSecret,
} from "../secrets/storage.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import type { EnvKeyConfig } from "../server/create-server.js";
import { resolveSecretDetailed } from "../server/credential-provider.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import { getIntegrationConfig } from "./config-store.js";
import {
  getMountedChannels,
  type MountedChannels,
} from "./mounted-channels.js";
import type { PlatformAdapter } from "./types.js";

export const CHANNEL_MANAGE_DENIED =
  "Only organization owners and admins can set up channels.";

export type ChannelState = "on" | "off" | "not-set-up";

/**
 * `saved`: saved from Channels for this workspace. `environment`: the
 * deployment's environment. `elsewhere`: another saved key answers, such as
 * a personal key or an organization vault key.
 */
export type ChannelCredentialSource = "saved" | "environment" | "elsewhere";

export interface ChannelCredentialStatus {
  key: string;
  label: string;
  required: boolean;
  helpText?: string;
  /** False when the adapter reads the key only from the deployment. */
  saveable: boolean;
  /** Where the value comes from; null when unset. Always null for members. */
  source: ChannelCredentialSource | null;
  /** Saved from Channels, so `remove-credentials` deletes it. */
  removable: boolean;
}

export interface MessagingChannelStatus {
  platform: string;
  label: string;
  /** On only when both enabled and configured. */
  state: ChannelState;
  enabled: boolean;
  configured: boolean;
  /** Null when the app's public URL isn't known for this call. */
  webhookUrl: string | null;
  details?: Record<string, unknown>;
  error?: string;
  credentials: ChannelCredentialStatus[];
}

export interface MessagingChannelsStatus {
  /** Owners and admins, or the only user of a workspace without an org. */
  canManage: boolean;
  channels: MessagingChannelStatus[];
}

interface ChannelAccess {
  email: string;
  scopeId: string;
  canManage: boolean;
}

async function resolveChannelAccess(
  ctx: ActionRunContext | undefined,
): Promise<ChannelAccess> {
  const email = ctx?.userEmail?.trim();
  if (!email) fail("Sign in to manage channels.", { statusCode: 401 });
  const orgId = ctx?.orgId?.trim();
  // Matches `checkOrgAdmin` in the integrations plugin: without an org there
  // is one user and no role gradient.
  if (!orgId) return { email, scopeId: `solo:${email}`, canManage: true };
  const role = await readOrgMemberRole(orgId, email);
  return {
    email,
    scopeId: orgId,
    canManage: role === "owner" || role === "admin",
  };
}

async function requireChannelManager(
  ctx: ActionRunContext | undefined,
): Promise<ChannelAccess> {
  const access = await resolveChannelAccess(ctx);
  if (!access.canManage) {
    fail(CHANNEL_MANAGE_DENIED, { statusCode: 403, errorCode: "forbidden" });
  }
  return access;
}

function requireMountedChannels(): MountedChannels {
  const mounted = getMountedChannels();
  if (!mounted) {
    fail("This app doesn't mount any messaging channels.", {
      statusCode: 404,
      errorCode: "channels_not_mounted",
    });
  }
  return mounted;
}

function requireAdapter(
  mounted: MountedChannels,
  platform: string,
): PlatformAdapter {
  const adapter = mounted.adapters.find((item) => item.platform === platform);
  if (!adapter) {
    fail(
      `"${platform}" isn't a channel in this app. Channels: ${mounted.adapters.map((item) => item.platform).join(", ") || "none"}.`,
      { statusCode: 404, errorCode: "channel_not_found" },
    );
  }
  return adapter;
}

/**
 * The public base URL a provider calls: `WEBHOOK_BASE_URL`, then the request's
 * own host (as the integrations routes use), then the app URL.
 */
function channelBaseUrl(ctx: ActionRunContext | undefined): string | null {
  const configured = getAppConfig().integrations.webhookBaseUrl;
  if (configured) return withConfiguredAppBasePath(configured);
  const host = ctx?.requestHeaders?.get("host");
  if (host) {
    const proto = ctx?.requestHeaders?.get("x-forwarded-proto") || "http";
    return withConfiguredAppBasePath(`${proto}://${host}`);
  }
  const appUrl = getAppConfig().app.url;
  return appUrl ? withConfiguredAppBasePath(appUrl) : null;
}

function isChannelsManaged(key: string): boolean {
  return resolveSecretManagedBy(key)?.id === SECRET_MANAGERS.channels.id;
}

async function readCredentialStatuses(
  keys: readonly EnvKeyConfig[],
  access: ChannelAccess,
): Promise<ChannelCredentialStatus[]> {
  const saved = access.canManage
    ? await readAppSecrets({
        keys: keys.map((item) => item.key),
        scope: "workspace",
        scopeId: access.scopeId,
      })
    : new Map<string, { value: string }>();
  const statuses: ChannelCredentialStatus[] = [];
  for (const item of keys) {
    let source: ChannelCredentialSource | null = null;
    if (access.canManage) {
      if (saved.get(item.key)?.value) {
        source = "saved";
      } else {
        const resolved = await resolveSecretDetailed(item.key);
        if (resolved.lookupFailed) {
          fail("Couldn't read the saved channel credentials. Try again.", {
            statusCode: 503,
            errorCode: "credential_store_unavailable",
          });
        }
        if (resolved.value) {
          source = resolved.source === "env" ? "environment" : "elsewhere";
        }
      }
    }
    statuses.push({
      key: item.key,
      label: item.label || item.key,
      required: item.required ?? false,
      ...(item.helpText ? { helpText: item.helpText } : {}),
      saveable: item.deploymentOnly !== true,
      source,
      removable: source === "saved" && isChannelsManaged(item.key),
    });
  }
  return statuses;
}

async function readChannelStatus(
  mounted: MountedChannels,
  adapter: PlatformAdapter,
  access: ChannelAccess,
  baseUrl: string | null,
): Promise<MessagingChannelStatus> {
  const status = await adapter.getStatus(baseUrl ?? undefined);
  const config = await getIntegrationConfig(adapter.platform);
  const enabled = !!config?.configData?.enabled;
  const configured = !!status.configured;
  return {
    platform: adapter.platform,
    label: status.label || adapter.label,
    state: !configured ? "not-set-up" : enabled ? "on" : "off",
    enabled,
    configured,
    webhookUrl: baseUrl ? mounted.webhookUrl(baseUrl, adapter.platform) : null,
    ...(status.details ? { details: status.details } : {}),
    ...(status.error ? { error: status.error } : {}),
    credentials: await readCredentialStatuses(
      adapter.getRequiredEnvKeys(),
      access,
    ),
  };
}

export async function listMessagingChannels(
  ctx: ActionRunContext | undefined,
): Promise<MessagingChannelsStatus> {
  const access = await resolveChannelAccess(ctx);
  const mounted = getMountedChannels();
  if (!mounted) return { canManage: access.canManage, channels: [] };
  const baseUrl = channelBaseUrl(ctx);
  const channels: MessagingChannelStatus[] = [];
  for (const adapter of mounted.adapters) {
    channels.push(await readChannelStatus(mounted, adapter, access, baseUrl));
  }
  return { canManage: access.canManage, channels };
}

export interface ChannelChangeResult {
  channel: MessagingChannelStatus;
  message: string;
}

export async function setMessagingChannelEnabled(
  ctx: ActionRunContext | undefined,
  platform: string,
  enabled: boolean,
): Promise<ChannelChangeResult> {
  const access = await requireChannelManager(ctx);
  const mounted = requireMountedChannels();
  const adapter = requireAdapter(mounted, platform);
  const baseUrl = channelBaseUrl(ctx);
  if (enabled) {
    const current = await readChannelStatus(mounted, adapter, access, baseUrl);
    if (!current.configured) {
      const missing = current.credentials
        .filter((item) => item.required && !item.source)
        .map((item) => item.key);
      fail(
        `${current.label} isn't set up yet.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""} Save its credentials with save-credentials first.`,
        {
          statusCode: 409,
          errorCode: "channel_not_configured",
          details: { missing },
        },
      );
    }
  }
  await mounted.setEnabled(platform, enabled, {
    actorEmail: access.email,
    ...(baseUrl ? { baseUrl } : {}),
  });
  const channel = await readChannelStatus(mounted, adapter, access, baseUrl);
  return {
    channel,
    message: `${channel.label} is ${enabled ? "on" : "off"}.`,
  };
}

const MAX_CREDENTIAL_LENGTH = 16_384;

export async function saveMessagingChannelCredentials(
  ctx: ActionRunContext | undefined,
  platform: string,
  values: Record<string, string>,
): Promise<ChannelChangeResult & { savedKeys: string[] }> {
  const access = await requireChannelManager(ctx);
  const mounted = requireMountedChannels();
  const adapter = requireAdapter(mounted, platform);
  const keys = new Map(
    adapter.getRequiredEnvKeys().map((item) => [item.key, item]),
  );
  const entries = Object.entries(values);
  if (entries.length === 0) {
    fail("Pass at least one credential in values.", {
      errorCode: "invalid_channel_credentials",
    });
  }
  const writes: Array<[string, string]> = [];
  for (const [key, raw] of entries) {
    const item = keys.get(key);
    if (!item) {
      fail(
        `${key} isn't a ${adapter.label} credential. Use one of: ${[...keys.keys()].join(", ")}.`,
        { errorCode: "invalid_channel_credentials", details: { key } },
      );
    }
    if (item.deploymentOnly) {
      fail(
        `${key} is read only from the deployment environment. Add it there and redeploy.`,
        { errorCode: "deployment_only_credential", details: { key } },
      );
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      fail(`Enter a value for ${key}.`, {
        errorCode: "invalid_channel_credentials",
        details: { key },
      });
    }
    if (value.length > MAX_CREDENTIAL_LENGTH) {
      fail(`${key} is too long.`, {
        errorCode: "invalid_channel_credentials",
        details: { key },
      });
    }
    writes.push([key, value]);
  }
  for (const [key, value] of writes) {
    await writeAppSecret({
      key,
      value,
      scope: "workspace",
      scopeId: access.scopeId,
      description: `${adapter.label} channel credential`,
    });
  }
  const channel = await readChannelStatus(
    mounted,
    adapter,
    access,
    channelBaseUrl(ctx),
  );
  const savedKeys = writes.map(([key]) => key);
  return {
    savedKeys,
    channel,
    message: channel.configured
      ? `Saved ${savedKeys.join(", ")}. ${channel.label} is ${channel.state === "on" ? "on" : "set up and off; call enable to turn it on"}.`
      : `Saved ${savedKeys.join(", ")}. ${channel.label} still needs its required credentials.`,
  };
}

export async function removeMessagingChannelCredentials(
  ctx: ActionRunContext | undefined,
  platform: string,
): Promise<ChannelChangeResult & { removedKeys: string[] }> {
  const access = await requireChannelManager(ctx);
  const mounted = requireMountedChannels();
  const adapter = requireAdapter(mounted, platform);
  const keys = adapter
    .getRequiredEnvKeys()
    .map((item) => item.key)
    .filter(isChannelsManaged);
  const saved = await readAppSecrets({
    keys,
    scope: "workspace",
    scopeId: access.scopeId,
  });
  const removedKeys: string[] = [];
  for (const key of keys) {
    if (!saved.get(key)?.value) continue;
    if (
      await deleteAppSecret({
        key,
        scope: "workspace",
        scopeId: access.scopeId,
      })
    ) {
      removedKeys.push(key);
    }
  }
  const channel = await readChannelStatus(
    mounted,
    adapter,
    access,
    channelBaseUrl(ctx),
  );
  return {
    removedKeys,
    channel,
    message:
      removedKeys.length === 0
        ? `No ${channel.label} credentials were saved from Channels.`
        : `Removed ${removedKeys.join(", ")}. ${channel.label} is ${channel.state === "not-set-up" ? "no longer set up" : channel.state}.`,
  };
}

export async function registerMessagingChannelWebhook(
  ctx: ActionRunContext | undefined,
  platform: string,
): Promise<ChannelChangeResult & { webhookUrl?: string }> {
  const access = await requireChannelManager(ctx);
  const mounted = requireMountedChannels();
  const adapter = requireAdapter(mounted, platform);
  const baseUrl = channelBaseUrl(ctx);
  if (!baseUrl) {
    fail(
      "Couldn't tell this app's public URL. Set WEBHOOK_BASE_URL or APP_URL, or register from Settings › Channels.",
      { statusCode: 409, errorCode: "public_url_unknown" },
    );
  }
  const registration = await mounted.registerWebhook(platform, baseUrl);
  if (registration.ok === false) {
    fail(registration.error, {
      statusCode: registration.statusCode,
      errorCode: "webhook_registration_failed",
    });
  }
  const channel = await readChannelStatus(mounted, adapter, access, baseUrl);
  return "webhookUrl" in registration
    ? {
        channel,
        webhookUrl: registration.webhookUrl,
        message: `Registered ${registration.webhookUrl} with ${channel.label}.`,
      }
    : { channel, message: `${channel.label} has no webhook to register.` };
}
