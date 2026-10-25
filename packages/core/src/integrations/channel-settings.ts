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

import { createHash } from "node:crypto";

import { fail, type ActionRunContext } from "../action.js";
import { getAppConfig } from "../app-config/index.js";
import { AppSecretDecryptionError } from "../secrets/errors.js";
import {
  resolveSecretManagedBy,
  SECRET_MANAGERS,
} from "../secrets/managed-keys.js";
import type { SecretScope } from "../secrets/register.js";
import {
  deleteAppSecretIfVersion,
  readAppSecretVersion,
  writeAppSecret,
} from "../secrets/storage.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";
import type { EnvKeyConfig } from "../server/create-server.js";
import {
  CredentialStoreUnavailableError,
  resolveSecretDetailed,
} from "../server/credential-provider.js";
import { readOrgMemberRole } from "../server/personal-provider-key-policy.js";
import {
  signShortLivedToken,
  verifyShortLivedToken,
} from "../server/short-lived-token.js";
import { getIntegrationConfig } from "./config-store.js";
import {
  getMountedChannels,
  type MountedChannels,
} from "./mounted-channels.js";
import type { PlatformAdapter } from "./types.js";

export const CHANNEL_MANAGE_DENIED =
  "Only organization owners and admins can set up channels.";

export type ChannelState = "on" | "off" | "not-set-up" | "unavailable";

/**
 * `saved`: saved from Channels for this workspace. `environment`: the
 * deployment's environment. `elsewhere`: another saved key answers, such as
 * a personal key or an organization vault key.
 */
export type ChannelCredentialSource =
  | "saved"
  | "environment"
  | "elsewhere"
  | "unreadable";

export interface ChannelCredentialStatus {
  key: string;
  label: string;
  required: boolean;
  helpText?: string;
  /** False when the adapter reads the key only from the deployment. */
  saveable: boolean;
  /** Where the value comes from; null when unset. Always null for members. */
  source: ChannelCredentialSource | null;
  /** Saved from Channels or exactly readable as a Channels-managed row. */
  removable: boolean;
  /** Scope where the unreadable ciphertext was found. */
  unreadableScope?: SecretScope;
  /** Scope where replacement will be written; `user` is the caller's own row. */
  repairScope?: SecretScope;
  /** Opaque exact-ref confirmation required by `remove-credentials`. */
  removalConfirmation?: string;
  /** Exact scope the removal confirmation is bound to. */
  removalScope?: SecretScope;
}

export interface MessagingChannelStatus {
  platform: string;
  label: string;
  /** On only when both enabled and configured. */
  state: ChannelState;
  enabled: boolean;
  configured: boolean;
  /** True when stored credentials prevented the adapter from checking setup. */
  configurationUnavailable?: boolean;
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
  orgId: string | null;
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
  if (!orgId)
    return { email, scopeId: `solo:${email}`, orgId: null, canManage: true };
  const role = await readOrgMemberRole(orgId, email);
  return {
    email,
    scopeId: orgId,
    orgId,
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

interface ChannelCredentialRef {
  key: string;
  scope: SecretScope;
  scopeId: string;
}

function recoveryRefsFor(
  key: string,
  access: ChannelAccess,
): ChannelCredentialRef[] {
  return [
    { key, scope: "user", scopeId: access.email },
    ...(access.orgId
      ? [{ key, scope: "org" as const, scopeId: access.orgId }]
      : []),
    { key, scope: "workspace", scopeId: access.scopeId },
    ...(access.orgId
      ? [
          {
            key,
            scope: "workspace" as const,
            scopeId: `solo:${access.email}`,
          },
        ]
      : []),
  ];
}

function isSecretScope(scope: string | undefined): scope is SecretScope {
  return scope === "user" || scope === "workspace" || scope === "org";
}

function exactUnreadableRef(
  key: string,
  access: ChannelAccess,
  error: AppSecretDecryptionError,
): ChannelCredentialRef | undefined {
  if (!isChannelsManaged(key) || !error.scope || !error.scopeId)
    return undefined;
  return recoveryRefsFor(key, access).find(
    (ref) => ref.scope === error.scope && ref.scopeId === error.scopeId,
  );
}

function repairTargetForError(
  key: string,
  access: ChannelAccess,
  error: AppSecretDecryptionError,
): ChannelCredentialRef | undefined {
  if (!isChannelsManaged(key) || !error.scope || !error.scopeId)
    return undefined;
  // The resolver fails on an unreadable personal row before trying workspace
  // credentials, so only its owner can repair that exact row.
  const exactRef = exactUnreadableRef(key, access, error);
  if (exactRef) return exactRef;

  // The resolver's only external org/workspace reads are the designated vault
  // fallback. Channels cannot write that shared scope; an owner/admin repairs
  // it by saving the key in their own workspace, which the resolver checks
  // before the vault.
  if (
    (error.scope === "org" || error.scope === "workspace") &&
    !recoveryRefsFor(key, access).some(
      (ref) => ref.scope === error.scope && ref.scopeId === error.scopeId,
    )
  ) {
    return { key, scope: "workspace", scopeId: access.scopeId };
  }
  return undefined;
}

type RemovalKind = "saved" | "unreadable";

function removalResourceId(
  ref: ChannelCredentialRef,
  kind: RemovalKind,
  version: string,
): string {
  const refFingerprint = createHash("sha256")
    .update(
      `${ref.key}\u0000${ref.scope}\u0000${ref.scopeId}\u0000${kind}\u0000${version}`,
    )
    .digest("base64url");
  return `channels-removal:${refFingerprint}`;
}

function removalConfirmation(
  ref: ChannelCredentialRef,
  email: string,
  kind: RemovalKind,
  version: string,
): string {
  return signShortLivedToken({
    resourceId: removalResourceId(ref, kind, version),
    viewerEmail: email,
  });
}

function confirmsRemoval(
  ref: ChannelCredentialRef,
  email: string,
  kind: RemovalKind,
  version: string,
  confirmation: string,
): boolean {
  const result = verifyShortLivedToken(
    confirmation,
    removalResourceId(ref, kind, version),
  );
  return result.ok && result.viewerEmail === email;
}

function requireReadableCredentialLookup(
  key: string,
  resolved: Awaited<ReturnType<typeof resolveSecretDetailed>>,
): void {
  if (!resolved.lookupFailed) return;
  if (resolved.cause instanceof AppSecretDecryptionError) return;
  fail("Couldn't read the saved channel credentials. Try again.", {
    statusCode: 503,
    errorCode: "credential_store_unavailable",
    details: { key },
  });
}

async function repairTargetFor(
  key: string,
  access: ChannelAccess,
): Promise<ChannelCredentialRef | undefined> {
  const resolved = await resolveSecretDetailed(key);
  requireReadableCredentialLookup(key, resolved);
  if (resolved.lookupFailed) {
    const ref =
      resolved.cause instanceof AppSecretDecryptionError
        ? repairTargetForError(key, access, resolved.cause)
        : undefined;
    if (!ref) {
      fail(
        "Couldn't identify the saved credential that needs repair. Try again.",
        {
          statusCode: 503,
          errorCode: "credential_store_unavailable",
          details: { key },
        },
      );
    }
    return ref;
  }
  return undefined;
}

interface ResolvedChannelCredentialStatus {
  status: ChannelCredentialStatus;
  removalRef?: ChannelCredentialRef;
  removalKind?: RemovalKind;
  removalVersion?: string;
}

async function readCredentialStatus(
  item: EnvKeyConfig,
  access: ChannelAccess,
): Promise<ResolvedChannelCredentialStatus> {
  let source: ChannelCredentialSource | null = null;
  let unreadableRef: ChannelCredentialRef | undefined;
  let unreadableScope: SecretScope | undefined;
  let repairRef: ChannelCredentialRef | undefined;
  if (access.canManage) {
    const resolved = await resolveSecretDetailed(item.key);
    requireReadableCredentialLookup(item.key, resolved);
    if (
      resolved.lookupFailed &&
      resolved.cause instanceof AppSecretDecryptionError
    ) {
      unreadableRef = exactUnreadableRef(item.key, access, resolved.cause);
      repairRef = repairTargetForError(item.key, access, resolved.cause);
      if (isSecretScope(resolved.cause.scope)) {
        unreadableScope = resolved.cause.scope;
      }
    }
    if (resolved.value) {
      source =
        resolved.source === "env"
          ? "environment"
          : resolved.source === "workspace" &&
              resolved.scopeId === access.scopeId
            ? "saved"
            : "elsewhere";
    } else if (resolved.lookupFailed) {
      source = "unreadable";
    }
  }
  const candidateRemovalRef =
    source === "saved"
      ? { key: item.key, scope: "workspace" as const, scopeId: access.scopeId }
      : unreadableRef;
  const removalKind: RemovalKind | undefined = unreadableRef
    ? "unreadable"
    : source === "saved"
      ? "saved"
      : undefined;
  const removalVersion =
    candidateRemovalRef && removalKind && isChannelsManaged(item.key)
      ? await readAppSecretVersion(candidateRemovalRef)
      : null;
  const removalRef = removalVersion ? candidateRemovalRef : undefined;
  const removable = removalRef !== undefined && isChannelsManaged(item.key);
  return {
    status: {
      key: item.key,
      label: item.label || item.key,
      required: item.required ?? false,
      ...(item.helpText ? { helpText: item.helpText } : {}),
      saveable: item.deploymentOnly !== true,
      source,
      removable,
      ...(unreadableScope ? { unreadableScope } : {}),
      ...(repairRef ? { repairScope: repairRef.scope } : {}),
      ...(removable && removalRef
        ? {
            removalScope: removalRef.scope,
            removalConfirmation: removalConfirmation(
              removalRef,
              access.email,
              removalKind!,
              removalVersion!,
            ),
          }
        : {}),
    },
    ...(removalRef ? { removalRef } : {}),
    ...(removalKind ? { removalKind } : {}),
    ...(removalVersion ? { removalVersion } : {}),
  };
}

async function readCredentialStatuses(
  keys: readonly EnvKeyConfig[],
  access: ChannelAccess,
): Promise<ChannelCredentialStatus[]> {
  const resolved = await Promise.all(
    keys.map((item) => readCredentialStatus(item, access)),
  );
  return resolved.map(({ status }) => status);
}

async function readChannelStatus(
  mounted: MountedChannels,
  adapter: PlatformAdapter,
  access: ChannelAccess,
  baseUrl: string | null,
): Promise<MessagingChannelStatus> {
  const credentialKeys = adapter.getRequiredEnvKeys();
  const credentials = await readCredentialStatuses(credentialKeys, access);
  const unreadableCredentials = credentials.filter(
    (item) => item.source === "unreadable",
  );
  let status: Awaited<ReturnType<PlatformAdapter["getStatus"]>>;
  let configurationUnavailable = unreadableCredentials.length > 0;
  if (configurationUnavailable) {
    status = {
      platform: adapter.platform,
      label: adapter.label,
      enabled: false,
      configured: false,
      error: `Couldn't read saved credentials: ${unreadableCredentials.map((item) => item.key).join(", ")}. Replace or remove them before enabling this channel.`,
    };
  } else {
    try {
      status = await adapter.getStatus(baseUrl ?? undefined);
    } catch (error) {
      if (!(error instanceof CredentialStoreUnavailableError)) throw error;
      configurationUnavailable = true;
      status = {
        platform: adapter.platform,
        label: adapter.label,
        enabled: false,
        configured: false,
        error:
          "Couldn't read saved channel credentials. Try again, or replace or remove the unreadable credential.",
      };
    }
  }
  const config = await getIntegrationConfig(adapter.platform);
  const enabled = !!config?.configData?.enabled;
  const configured = !!status.configured;
  return {
    platform: adapter.platform,
    label: status.label || adapter.label,
    state: configurationUnavailable
      ? "unavailable"
      : !configured
        ? "not-set-up"
        : enabled
          ? "on"
          : "off",
    enabled,
    configured,
    ...(configurationUnavailable ? { configurationUnavailable: true } : {}),
    webhookUrl: baseUrl ? mounted.webhookUrl(baseUrl, adapter.platform) : null,
    ...(status.details ? { details: status.details } : {}),
    ...(status.error ? { error: status.error } : {}),
    credentials,
  };
}

export async function listMessagingChannels(
  ctx: ActionRunContext | undefined,
): Promise<MessagingChannelsStatus> {
  const access = await resolveChannelAccess(ctx);
  const mounted = getMountedChannels();
  if (!mounted) return { canManage: access.canManage, channels: [] };
  const baseUrl = channelBaseUrl(ctx);
  const channels = await Promise.all(
    mounted.adapters.map((adapter) =>
      readChannelStatus(mounted, adapter, access, baseUrl),
    ),
  );
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
    if (current.configurationUnavailable) {
      fail(current.error ?? "Couldn't confirm the channel's credentials.", {
        statusCode: 503,
        errorCode: "credential_store_unavailable",
      });
    }
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
  const targets = await Promise.all(
    writes.map(
      async ([key]) =>
        (await repairTargetFor(key, access)) ?? {
          key,
          scope: "workspace" as const,
          scopeId: access.scopeId,
        },
    ),
  );
  for (const [[key, value], target] of writes.map(
    (entry, index) => [entry, targets[index]] as const,
  )) {
    await writeAppSecret({
      key,
      value,
      scope: target.scope,
      scopeId: target.scopeId,
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
    message: channel.configurationUnavailable
      ? `Saved ${savedKeys.join(", ")}. ${channel.label} still has credentials that cannot be read; replace or remove them before enabling the channel.`
      : channel.configured
        ? `Saved ${savedKeys.join(", ")}. ${channel.label} is ${channel.state === "on" ? "on" : "set up and off; call enable to turn it on"}.`
        : `Saved ${savedKeys.join(", ")}. ${channel.label} still needs its required credentials.`,
  };
}

export async function removeMessagingChannelCredentials(
  ctx: ActionRunContext | undefined,
  platform: string,
  confirmedCredentials: readonly {
    key: string;
    removalConfirmation: string;
  }[],
): Promise<ChannelChangeResult & { removedKeys: string[] }> {
  const access = await requireChannelManager(ctx);
  const mounted = requireMountedChannels();
  const adapter = requireAdapter(mounted, platform);
  if (
    !Array.isArray(confirmedCredentials) ||
    confirmedCredentials.length === 0
  ) {
    fail("Confirm the channel credentials shown for removal.", {
      statusCode: 400,
      errorCode: "channel_removal_confirmation_required",
    });
  }

  const keys = new Map(
    adapter
      .getRequiredEnvKeys()
      .filter((item) => isChannelsManaged(item.key))
      .map((item) => [item.key, item]),
  );
  const uniqueConfirmed = new Map<string, string>();
  for (const item of confirmedCredentials) {
    if (
      !item ||
      typeof item.key !== "string" ||
      typeof item.removalConfirmation !== "string" ||
      !item.removalConfirmation ||
      !keys.has(item.key) ||
      uniqueConfirmed.has(item.key)
    ) {
      fail(
        "The channel removal confirmation is invalid. Refresh and try again.",
        {
          statusCode: 409,
          errorCode: "channel_removal_confirmation_stale",
        },
      );
    }
    uniqueConfirmed.set(item.key, item.removalConfirmation);
  }

  const credentials = await Promise.all(
    [...uniqueConfirmed.keys()].map((key) =>
      readCredentialStatus(keys.get(key)!, access),
    ),
  );
  const refsToRemove: Array<{
    ref: ChannelCredentialRef;
    version: string;
  }> = [];
  for (const {
    status,
    removalRef,
    removalKind,
    removalVersion,
  } of credentials) {
    const confirmation = uniqueConfirmed.get(status.key);
    if (
      !status.removable ||
      !removalRef ||
      !removalKind ||
      !removalVersion ||
      !confirmation ||
      !confirmsRemoval(
        removalRef,
        access.email,
        removalKind,
        removalVersion,
        confirmation,
      )
    ) {
      fail(
        "The channel credentials changed. Refresh and confirm removal again.",
        {
          statusCode: 409,
          errorCode: "channel_removal_confirmation_stale",
          details: { key: status.key },
        },
      );
    }
    refsToRemove.push({ ref: removalRef, version: removalVersion });
  }

  const removedKeys: string[] = [];
  for (const { ref, version } of refsToRemove) {
    if (!(await deleteAppSecretIfVersion(ref, version))) {
      fail(
        "The channel credentials changed. Refresh and confirm removal again.",
        {
          statusCode: 409,
          errorCode: "channel_removal_confirmation_stale",
          details: { key: ref.key },
        },
      );
    }
    if (!removedKeys.includes(ref.key)) removedKeys.push(ref.key);
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
