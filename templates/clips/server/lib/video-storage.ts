import { getDbExec } from "@agent-native/core/db";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
  type FileUploadProvider,
} from "@agent-native/core/file-upload";
import {
  BUILDER_ASSETS_WRITE_SCOPE,
  canAuthorizeBuilderApiRequest,
  getAppConfig,
  hasBuilderApiCredentialCustody,
  resolveClipsHostedStorageConfig,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { and, desc, eq } from "drizzle-orm";

import { CLIPS_HOSTED_FREE_CLIPS_FLAG } from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";
import {
  accountHostedClipAdditionalBytes,
  canonicalHostedClipIdentityKey,
  adjustHostedClipRetainedBytes,
  addHostedClipRetainedBytesWithinCap,
  consumeHostedClipAllowance,
  getHostedClipAllowanceStatus,
  getHostedClipAllowanceSnapshot,
  hostedClipIpPrefix,
  reacquireHostedClipAllowanceForRetry,
  releaseHostedClipAllowance,
  reserveHostedClipAllowance,
  type HostedClipAllowanceDenialReason,
  type HostedClipAllowancePolicy,
} from "./hosted-clip-allowance.js";
import { HOSTED_CLIP_DISPOSABLE_EMAIL_DOMAINS } from "./hosted-clip-disposable-domains.js";
import { ownerEmailMatches } from "./recordings.js";
import {
  clipsHostedFileUploadProvider,
  fetchS3ObjectByUrl,
} from "./s3-upload-provider.js";

export const STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.";
export const HOSTED_STORAGE_UNAVAILABLE_REASON =
  "Clips hosted storage is temporarily unavailable. Try again later.";

export class VideoStorageStatusUnavailableError extends Error {
  readonly causes: unknown[];

  constructor(causes: unknown[]) {
    super("Video storage status could not be checked");
    this.name = "VideoStorageStatusUnavailableError";
    this.causes = causes;
  }
}

function appDatabaseUrl(): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const appUrl = process.env[`${appName}_DATABASE_URL`];
    if (appUrl) return appUrl;
  }
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";
}

function isLikelyLocalDatabase(): boolean {
  const url = appDatabaseUrl();
  return url === "" || url.startsWith("pglite:");
}

export function requiresConfiguredVideoStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isLikelyLocalDatabase();
}

export function allowsSqlRecordingChunkScratch(): boolean {
  return !requiresConfiguredVideoStorage();
}

export type ClipsVideoStorageMode = "own" | "hosted" | "none";

export type ClipsVideoStorageResolution = {
  mode: ClipsVideoStorageMode;
  provider: FileUploadProvider | null;
  hostedRemaining: number;
  hostedLimit: number;
  maxClipBytes: number;
  maxClipDurationMs: number;
  reservationCreated?: boolean;
  denyReason?: HostedClipAllowanceDenialReason;
};

type ClipsHostedStorageConfig = ReturnType<
  typeof getAppConfig
>["clips"]["hostedStorage"];

function hostedPolicy(
  config: ClipsHostedStorageConfig,
): HostedClipAllowancePolicy {
  return {
    enabled: config.enabled,
    perIdentityClipLimit: config.perIdentityClipLimit,
    ipPrefixDailyGrantCap: config.ipPrefixDailyGrantCap,
    globalDailyClipCap: config.globalDailyClipCap,
    globalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
    reservationBytes: config.maxClipBytes,
    disposableDomains: HOSTED_CLIP_DISPOSABLE_EMAIL_DOMAINS,
  };
}

function hostedLimits(config: ClipsHostedStorageConfig) {
  return {
    hostedLimit: config.perIdentityClipLimit,
    maxClipBytes: config.maxClipBytes,
    maxClipDurationMs: config.maxClipDurationMs,
  };
}

function requestIdentity(
  input: {
    email?: string | null;
    userId?: string | null;
  } = {},
) {
  const request = getRequestContext();
  return {
    email: input.email ?? request?.userEmail ?? null,
    userId: input.userId ?? request?.authUserId ?? null,
  };
}

function hostedFreeClipsEnabled(identity: { email?: string | null }) {
  return isFeatureFlagEnabled(CLIPS_HOSTED_FREE_CLIPS_FLAG, {
    userEmail: identity.email ?? undefined,
    orgId: getRequestContext()?.orgId ?? null,
  });
}

function requestIpPrefix(headers?: Headers): string | null {
  // Netlify replaces this header with the client address at the edge. Do not
  // trust arbitrary forwarded-for values supplied by a browser.
  return hostedClipIpPrefix(headers?.get("x-nf-client-connection-ip"));
}

async function readEmailVerified(
  userId: string,
  email: string,
): Promise<boolean> {
  const result = await getDbExec().execute({
    sql: 'SELECT email, email_verified FROM "user" WHERE id = ? LIMIT 1',
    args: [userId],
  });
  const row = result.rows[0] as
    | { email?: unknown; email_verified?: unknown }
    | undefined;
  if (!row || typeof row.email !== "string") {
    throw new Error("Authenticated Clips user could not be verified.");
  }
  if (row.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error(
      "Authenticated Clips user email does not match the session.",
    );
  }
  return row.email_verified === true;
}

async function ownStorageStatus() {
  const [active, builderConfigured, builderUploadConfigured] =
    await Promise.all([
      getActiveFileUploadProviderForRequest(),
      hasBuilderApiCredentialCustody(),
      canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE),
    ]);
  const isBuilderEnvActive = active?.id === "builder";
  const configured = isBuilderEnvActive
    ? builderUploadConfigured
    : !!active || builderUploadConfigured;
  const activeProvider = isBuilderEnvActive
    ? builderUploadConfigured
      ? { id: "builder", name: "Builder.io" }
      : null
    : active
      ? active.id === "builder" && !builderUploadConfigured
        ? null
        : { id: active.id, name: active.name }
      : builderUploadConfigured
        ? { id: "builder", name: "Builder.io" }
        : null;

  return {
    configured,
    active,
    activeProvider,
    builderConfigured,
    builderUploadConfigured,
    builderReauthorizationRequired:
      builderConfigured && !builderUploadConfigured,
  };
}

/**
 * Pins new recordings to the user's own provider when available. Otherwise it
 * atomically reserves a hosted allowance before returning a hosted target.
 * Existing recordings always follow their persisted storage_mode.
 */
export async function resolveClipsVideoStorage(input: {
  intent: "new" | "existing";
  recordingId: string;
  email?: string | null;
  userId?: string | null;
  requestHeaders?: Headers;
}): Promise<ClipsVideoStorageResolution> {
  const config = getAppConfig().clips.hostedStorage;
  // This remains a loud deployment error even when a user has their own
  // provider: enabling hosted storage without its private bucket is invalid.
  resolveClipsHostedStorageConfig(config);
  const identity = requestIdentity(input);
  const policy = hostedPolicy(config);
  const limits = hostedLimits(config);

  if (!input.recordingId.trim()) {
    throw new Error("Clips video storage needs a recording id.");
  }

  if (input.intent === "existing") {
    if (!identity.email) {
      return {
        mode: "none",
        provider: null,
        hostedRemaining: 0,
        ...limits,
        denyReason: "sign_in_required",
      };
    }
    const [recording] = await getDb()
      .select({ storageMode: schema.recordings.storageMode })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, input.recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, identity.email),
        ),
      )
      .limit(1);
    if (!recording)
      throw new Error("Recording not found for Clips storage resolution.");
    if (recording.storageMode === "hosted") {
      return {
        mode: "hosted",
        provider: clipsHostedFileUploadProvider,
        hostedRemaining: 0,
        ...limits,
      };
    }
    return {
      mode: "own",
      provider: await getActiveFileUploadProviderForRequest(),
      hostedRemaining: 0,
      ...limits,
    };
  }

  const ownStorage = await ownStorageStatus();
  if (ownStorage.configured) {
    return {
      mode: "own",
      provider: ownStorage.active,
      hostedRemaining: 0,
      ...limits,
    };
  }

  // Local development may intentionally buffer chunks in SQL. It does not
  // consume a hosted trial grant.
  if (allowsSqlRecordingChunkScratch()) {
    return {
      mode: "own",
      provider: null,
      hostedRemaining: 0,
      ...limits,
    };
  }

  if (!identity.email || !identity.userId) {
    return {
      mode: "none",
      provider: null,
      hostedRemaining: 0,
      ...limits,
      denyReason: "sign_in_required",
    };
  }

  if (!(await hostedFreeClipsEnabled(identity))) {
    return {
      mode: "none",
      provider: null,
      hostedRemaining: 0,
      ...limits,
      denyReason: "disabled",
    };
  }

  const emailVerified = await readEmailVerified(
    identity.userId,
    identity.email,
  );
  const snapshotBeforeReservation = await getHostedClipAllowanceSnapshot({
    ...identity,
    emailVerified,
    ipPrefix: requestIpPrefix(input.requestHeaders),
    policy,
  });
  const reservation = await reserveHostedClipAllowance({
    ...identity,
    emailVerified,
    recordingId: input.recordingId,
    ipPrefix: requestIpPrefix(input.requestHeaders),
    policy,
  });
  if (!reservation.ok) {
    return {
      mode: "none",
      provider: null,
      hostedRemaining: 0,
      ...limits,
      denyReason: reservation.reason,
    };
  }
  return {
    mode: "hosted",
    provider: clipsHostedFileUploadProvider,
    hostedRemaining: Math.max(
      0,
      snapshotBeforeReservation.remainingCount -
        (reservation.alreadyReserved ? 0 : 1),
    ),
    reservationCreated: !reservation.alreadyReserved,
    ...limits,
  };
}

export async function getClipsVideoStorageStatus(
  input: {
    email?: string | null;
    userId?: string | null;
    requestHeaders?: Headers;
  } = {},
) {
  const config = getAppConfig().clips.hostedStorage;
  resolveClipsHostedStorageConfig(config);
  const ownStorage = await ownStorageStatus();
  const limits = hostedLimits(config);
  const legacyStatus = {
    activeProvider: ownStorage.activeProvider,
    builderConfigured: ownStorage.builderConfigured,
    builderUploadConfigured: ownStorage.builderUploadConfigured,
    builderReauthorizationRequired: ownStorage.builderReauthorizationRequired,
  };

  if (ownStorage.configured) {
    return {
      configured: true,
      ...legacyStatus,
      mode: "own" as const,
      hostedRemaining: 0,
      ...limits,
    };
  }

  const identity = requestIdentity(input);
  if (!identity.email || !identity.userId) {
    return {
      configured: false,
      ...legacyStatus,
      mode: "none" as const,
      hostedRemaining: 0,
      ...limits,
      denyReason: "sign_in_required" as const,
    };
  }

  if (!(await hostedFreeClipsEnabled(identity))) {
    return {
      configured: false,
      ...legacyStatus,
      mode: "none" as const,
      hostedRemaining: 0,
      ...limits,
      hostedLimit: 0,
      denyReason: "disabled" as const,
    };
  }

  const emailVerified = await readEmailVerified(
    identity.userId,
    identity.email,
  );
  const snapshot = await getHostedClipAllowanceSnapshot({
    ...identity,
    emailVerified,
    ipPrefix: requestIpPrefix(input.requestHeaders),
    policy: hostedPolicy(config),
  });
  const latestHostedRecording = await getDb()
    .select({ failureCode: schema.recordings.failureCode })
    .from(schema.recordings)
    .where(
      and(
        ownerEmailMatches(schema.recordings.ownerEmail, identity.email),
        eq(schema.recordings.storageMode, "hosted"),
      ),
    )
    .orderBy(desc(schema.recordings.createdAt))
    .limit(1);
  const providerError =
    latestHostedRecording[0]?.failureCode === "hosted_storage_unavailable"
      ? ("hosted_storage_unavailable" as const)
      : undefined;
  if (snapshot.status === "available") {
    return {
      configured: true,
      ...legacyStatus,
      mode: "hosted" as const,
      hostedRemaining: snapshot.remainingCount,
      ...(providerError ? { providerError } : {}),
      ...limits,
    };
  }
  return {
    configured: false,
    ...legacyStatus,
    mode: "none" as const,
    hostedRemaining: snapshot.remainingCount,
    ...(providerError ? { providerError } : {}),
    ...limits,
    denyReason: snapshot.denialReason ?? "exhausted",
  };
}

export async function consumeHostedClipRecording(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
  actualBytes: number;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return consumeHostedClipAllowance({
    recordingId: input.recordingId,
    userId,
    actualBytes: input.actualBytes,
    globalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
  });
}

export async function adjustHostedClipRecordingBytes(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
  retainedBytes: number;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return adjustHostedClipRetainedBytes({
    recordingId: input.recordingId,
    userId,
    retainedBytes: input.retainedBytes,
    globalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
  });
}

export async function getHostedClipRecordingAllowance(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
}) {
  const userId = await resolveAllowanceUserId(input);
  return getHostedClipAllowanceStatus({
    recordingId: input.recordingId,
    userId,
  });
}

export async function addHostedClipRecordingBytes(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
  additionalBytes: number;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return addHostedClipRetainedBytesWithinCap({
    recordingId: input.recordingId,
    userId,
    additionalBytes: input.additionalBytes,
    globalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
  });
}

/** Accounts for an uploaded derivative when its cap-denied cleanup failed. */
export async function accountHostedClipAdditionalRecordingBytes(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
  additionalBytes: number;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return accountHostedClipAdditionalBytes({
    recordingId: input.recordingId,
    userId,
    additionalBytes: input.additionalBytes,
    alertGlobalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
  });
}

/** Records known retained bytes even after a cap-denied upload could not be deleted. */
export async function accountHostedClipRecordingBytes(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
  retainedBytes: number;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return adjustHostedClipRetainedBytes({
    recordingId: input.recordingId,
    userId,
    retainedBytes: input.retainedBytes,
    globalRetainedByteCap: config.globalRetainedByteCap,
    retainedByteAlertRatio: config.retainedByteAlertRatio,
  });
}

export async function releaseHostedClipRecording(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
}) {
  const userId = await resolveAllowanceUserId(input);
  return releaseHostedClipAllowance({
    recordingId: input.recordingId,
    userId,
  });
}

export async function reacquireHostedClipRecordingForRetry(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail: string;
}) {
  const config = getAppConfig().clips.hostedStorage;
  const userId = await resolveAllowanceUserId(input);
  return reacquireHostedClipAllowanceForRetry({
    recordingId: input.recordingId,
    userId,
    ownerEmail: input.ownerEmail,
    reservationBytes: config.maxClipBytes,
    perIdentityClipLimit: config.perIdentityClipLimit,
    globalRetainedByteCap: config.globalRetainedByteCap,
  });
}

async function resolveAllowanceUserId(input: {
  recordingId: string;
  userId?: string | null;
  ownerEmail?: string | null;
}): Promise<string> {
  const userId = input.userId?.trim();
  if (userId) return userId;

  if (!canonicalHostedClipIdentityKey(input.ownerEmail)) {
    throw new Error("Hosted Clips allowance owner identity is unavailable.");
  }
  const [recording] = await getDb()
    .select({ ownerEmail: schema.recordings.ownerEmail })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, input.recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail!),
      ),
    )
    .limit(1);
  if (!recording) {
    throw new Error(
      "Hosted Clips allowance recording owner could not be verified.",
    );
  }
  // Ownership was verified against the live recording row above. The allowance
  // keeps its original identity_key across an email change, so it is found by
  // its primary key rather than by the current email.
  const [allowance] = await getDb()
    .select({ userId: schema.hostedClipAllowances.userId })
    .from(schema.hostedClipAllowances)
    .where(eq(schema.hostedClipAllowances.recordingId, input.recordingId))
    .limit(1);
  if (!allowance?.userId) {
    throw new Error("Hosted Clips allowance owner could not be resolved.");
  }
  return allowance.userId;
}

export async function verifyHostedClipMedia(input: {
  recordingId: string;
  videoUrl: string;
}): Promise<number> {
  const response = await fetchS3ObjectByUrl(input.videoUrl, {
    range: "bytes=0-1023",
    recordingId: input.recordingId,
    storageMode: "hosted",
  });
  if (!response || (response.status !== 200 && response.status !== 206)) {
    await response?.body?.cancel().catch(() => undefined);
    throw new Error("Hosted Clips media could not be verified as playable.");
  }

  const contentRange = response.headers.get("content-range") ?? "";
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1]);
  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes =
    Number.isSafeInteger(rangeTotal) && rangeTotal > 0
      ? rangeTotal
      : response.status === 200 &&
          Number.isSafeInteger(contentLength) &&
          contentLength > 0
        ? contentLength
        : null;
  const reader = response.body?.getReader();
  if (!reader || totalBytes === null) {
    await reader?.cancel().catch(() => undefined);
    throw new Error("Hosted Clips media size could not be verified.");
  }

  try {
    const { value } = await reader.read();
    if (!value?.byteLength) {
      throw new Error("Hosted Clips media did not return playable bytes.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return totalBytes;
}

interface VideoStorageResolveContext {
  userEmail?: string;
  orgId?: string | null;
}

export async function hasRequestVideoStorage(
  context?: VideoStorageResolveContext,
): Promise<boolean> {
  const resolve = async () => {
    const failures: unknown[] = [];
    for (const provider of listFileUploadProviders()) {
      if (provider.id === "builder") continue;
      try {
        if (provider.isConfigured()) return true;
      } catch (error) {
        failures.push(error);
      }
      if (provider.isConfiguredForRequest) {
        try {
          if (await provider.isConfiguredForRequest()) return true;
        } catch (error) {
          failures.push(error);
        }
      }
    }

    try {
      if (await canAuthorizeBuilderApiRequest(BUILDER_ASSETS_WRITE_SCOPE)) {
        return true;
      }
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0) {
      throw new VideoStorageStatusUnavailableError(failures);
    }
    return false;
  };

  if (context?.userEmail) {
    return runWithRequestContext(
      { userEmail: context.userEmail, orgId: context.orgId ?? undefined },
      resolve,
    );
  }
  return resolve();
}

export async function shouldRejectVideoUploadWithoutStorage(input?: {
  storageMode?: "own" | "hosted" | null;
}): Promise<boolean> {
  if (!requiresConfiguredVideoStorage()) return false;
  if (input?.storageMode === "hosted") {
    const configured = clipsHostedFileUploadProvider.isConfiguredForRequest
      ? await clipsHostedFileUploadProvider.isConfiguredForRequest()
      : clipsHostedFileUploadProvider.isConfigured();
    return !configured;
  }
  return !(await hasRequestVideoStorage());
}
