import { z } from "zod";

import { AppConfigurationError } from "./configuration-error.js";

/**
 * A private S3-compatible bucket the deployment runs for every app's private
 * files, so private pages don't depend on each workspace connecting storage.
 * It is the bucket Clips uses for hosted recordings, so its settings read the
 * older `CLIPS_HOSTED_STORAGE_*` names first: when both are set, they win, and
 * recordings already stored there stay readable.
 */
export const hostedStorageConfig = z.object({
  enabled: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_HOSTED_STORAGE_ENABLED",
    doc: "Store private blobs in the deployment's hosted private bucket when the workspace has no storage of its own.",
  }),
  endpoint: z
    .string()
    .url()
    .optional()
    .meta({
      env: [
        "CLIPS_HOSTED_STORAGE_ENDPOINT",
        "AGENT_NATIVE_HOSTED_STORAGE_ENDPOINT",
      ],
      doc: "S3-compatible endpoint for the hosted private bucket.",
    }),
  bucket: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "CLIPS_HOSTED_STORAGE_BUCKET",
        "AGENT_NATIVE_HOSTED_STORAGE_BUCKET",
      ],
      doc: "Hosted private bucket. It must not be publicly readable.",
    }),
  accessKeyId: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID",
        "AGENT_NATIVE_HOSTED_STORAGE_ACCESS_KEY_ID",
      ],
      doc: "Access key for the hosted private bucket.",
    }),
  secretAccessKey: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "CLIPS_HOSTED_STORAGE_SECRET_ACCESS_KEY",
        "AGENT_NATIVE_HOSTED_STORAGE_SECRET_ACCESS_KEY",
      ],
      doc: "Secret access key for the hosted private bucket.",
    }),
  region: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "CLIPS_HOSTED_STORAGE_REGION",
        "AGENT_NATIVE_HOSTED_STORAGE_REGION",
      ],
      doc: "Region of the hosted private bucket.",
    }),
});

export type HostedStorageConfig = z.output<typeof hostedStorageConfig>;

export interface ResolvedHostedStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * The hosted bucket's settings, or null when hosted storage is off. Throws
 * when it is on but a setting is missing, so a half-configured deployment
 * fails loudly instead of quietly falling back to public storage.
 */
export function resolveHostedStorageConfig(
  config: HostedStorageConfig,
): ResolvedHostedStorageConfig | null {
  if (!config.enabled) return null;
  const settings = {
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  };
  const missing = Object.entries(settings)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new AppConfigurationError(
      `Hosted storage is enabled but missing required settings: ${missing.join(", ")}.`,
    );
  }
  return settings as ResolvedHostedStorageConfig;
}
