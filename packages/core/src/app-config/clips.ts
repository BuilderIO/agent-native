import { z } from "zod";

import { AppConfigurationError } from "./configuration-error.js";

export const clipsHostedStorageConfig = z.object({
  enabled: z.boolean().default(false).meta({
    env: "CLIPS_HOSTED_STORAGE_ENABLED",
    doc: "Enable server-hosted Clips recordings.",
  }),
  endpoint: z.string().url().optional().meta({
    env: "CLIPS_HOSTED_STORAGE_ENDPOINT",
    doc: "S3-compatible endpoint for server-hosted Clips recordings.",
  }),
  bucket: z.string().min(1).optional().meta({
    env: "CLIPS_HOSTED_STORAGE_BUCKET",
    doc: "Private object-storage bucket for server-hosted Clips recordings.",
  }),
  accessKeyId: z.string().min(1).optional().meta({
    env: "CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID",
    doc: "Access key for server-hosted Clips object storage.",
  }),
  secretAccessKey: z.string().min(1).optional().meta({
    env: "CLIPS_HOSTED_STORAGE_SECRET_ACCESS_KEY",
    doc: "Secret access key for server-hosted Clips object storage.",
  }),
  region: z.string().min(1).optional().meta({
    env: "CLIPS_HOSTED_STORAGE_REGION",
    doc: "S3-compatible object-storage region for server-hosted Clips recordings.",
  }),
  perIdentityClipLimit: z.number().int().positive().default(3).meta({
    env: "CLIPS_HOSTED_STORAGE_PER_IDENTITY_CLIP_LIMIT",
    doc: "Maximum number of retained hosted Clips recordings per identity.",
  }),
  maxClipBytes: z
    .number()
    .int()
    .positive()
    .default(250 * 1024 * 1024)
    .meta({
      env: "CLIPS_HOSTED_STORAGE_MAX_CLIP_BYTES",
      doc: "Maximum size of a hosted Clips recording in bytes.",
    }),
  maxClipDurationMs: z
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000)
    .meta({
      env: "CLIPS_HOSTED_STORAGE_MAX_CLIP_DURATION_MS",
      doc: "Maximum recording duration shown by the Clips UI; the hosted-storage server does not enforce duration.",
    }),
  globalDailyClipCap: z.number().int().positive().optional().meta({
    env: "CLIPS_HOSTED_STORAGE_GLOBAL_DAILY_CLIP_CAP",
    doc: "Optional maximum number of hosted Clips recordings granted per day across the deployment.",
  }),
  ipPrefixDailyGrantCap: z.number().int().positive().optional().meta({
    env: "CLIPS_HOSTED_STORAGE_IP_PREFIX_DAILY_GRANT_CAP",
    doc: "Optional maximum number of hosted Clips recording grants per IP prefix per day.",
  }),
  globalRetainedByteCap: z.number().int().positive().optional().meta({
    env: "CLIPS_HOSTED_STORAGE_GLOBAL_RETAINED_BYTE_CAP",
    doc: "Optional maximum total bytes retained in hosted Clips object storage.",
  }),
  retainedByteAlertRatio: z.number().min(0).max(1).default(0.8).meta({
    env: "CLIPS_HOSTED_STORAGE_RETAINED_BYTE_ALERT_RATIO",
    doc: "Fraction of the global retained-byte cap at which hosted Clips storage should alert.",
  }),
});

export const clipsConfig = z.object({
  hostedStorage: clipsHostedStorageConfig.prefault({}),
  contentPeerSecret: z.string().optional().meta({
    env: "CONTENT_CLIPS_PEER_SECRET",
    doc: "Secret only the Content and Clips deployments hold. Content signs its server-to-server requests about Clips in its documents with it, and Clips accepts no other credential on those routes. Must differ from A2A_SECRET.",
  }),
});

export type ClipsConfig = z.output<typeof clipsConfig>;

export type ClipsHostedStorageConfig = z.output<
  typeof clipsHostedStorageConfig
>;

const MIN_CONTENT_CLIPS_PEER_SECRET_CHARS = 32;

/**
 * The secret Content and Clips sign and verify Content's Clip requests with,
 * or null when it is not set. Read it through this on both sides: a value
 * equal to the deployment `A2A_SECRET` is one every app holds, so it would
 * not show that a request came from Content, and it is refused rather than
 * used.
 */
export function resolveContentClipsPeerSecret(
  config: ClipsConfig,
  deploymentA2ASecret: string | undefined,
): string | null {
  const secret = config.contentPeerSecret?.trim();
  if (!secret) return null;
  if (secret.length < MIN_CONTENT_CLIPS_PEER_SECRET_CHARS) {
    throw new AppConfigurationError(
      `CONTENT_CLIPS_PEER_SECRET must be at least ${MIN_CONTENT_CLIPS_PEER_SECRET_CHARS} characters.`,
    );
  }
  if (secret === deploymentA2ASecret?.trim()) {
    throw new AppConfigurationError(
      "CONTENT_CLIPS_PEER_SECRET must differ from A2A_SECRET.",
    );
  }
  return secret;
}

export type ResolvedClipsHostedStorageConfig = ClipsHostedStorageConfig & {
  enabled: true;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function resolveClipsHostedStorageConfig(
  config: ClipsHostedStorageConfig,
): ResolvedClipsHostedStorageConfig | null {
  if (!config.enabled) return null;

  const requiredSettings = {
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  };
  const missingSettings = Object.entries(requiredSettings)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);

  if (missingSettings.length > 0) {
    throw new AppConfigurationError(
      `Clips hosted storage is enabled but missing required settings: ${missingSettings.join(", ")}.`,
    );
  }

  return {
    ...config,
    ...requiredSettings,
    enabled: true,
  } as ResolvedClipsHostedStorageConfig;
}
