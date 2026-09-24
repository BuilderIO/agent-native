/**
 * One contract for the S3-compatible storage keys: which keys exist, which a
 * provider needs, and what makes a value usable. Providers that read these
 * keys and forms that write them all go through `parseS3StorageConfig`, so a
 * form cannot accept a value the provider holding the "s3" slot will reject.
 *
 * Isomorphic on purpose: providers run it on the server, forms run the same
 * function in the browser before saving, and the save route runs it again.
 */

export const S3_STORAGE_KEYS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_PUBLIC_BASE_URL",
] as const;

export type S3StorageKey = (typeof S3_STORAGE_KEYS)[number];

/** Older deployments use R2_* names. Providers read them when the S3_* key is unset. */
export const S3_STORAGE_LEGACY_KEYS: Readonly<Record<S3StorageKey, string>> = {
  S3_ENDPOINT: "R2_ENDPOINT",
  S3_BUCKET: "R2_BUCKET",
  S3_ACCESS_KEY_ID: "R2_ACCESS_KEY_ID",
  S3_SECRET_ACCESS_KEY: "R2_SECRET_ACCESS_KEY",
  S3_REGION: "R2_REGION",
  S3_PUBLIC_BASE_URL: "R2_PUBLIC_BASE_URL",
};

export const S3_STORAGE_SECRET_KEYS: ReadonlySet<S3StorageKey> = new Set([
  "S3_SECRET_ACCESS_KEY",
]);

export interface S3StorageRequirements {
  /**
   * "required" when the app reads uploads back over plain HTTP (chat
   * attachments, private-blob read-back). "optional" only when the app reads
   * objects back with signed requests, so the stored URL never has to be
   * publicly readable.
   */
  publicBaseUrl: "required" | "optional";
}

export type S3StorageFieldErrorCode =
  | "missing"
  | "invalid-url"
  | "invalid-bucket"
  | "region-required";

export interface S3StorageFieldError {
  key: S3StorageKey;
  code: S3StorageFieldErrorCode;
}

export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicBaseUrl: string | null;
}

export type S3StorageValues = Partial<
  Record<S3StorageKey, string | null | undefined>
>;

export type S3StorageParseResult =
  | { ok: true; config: S3StorageConfig }
  | {
      ok: false;
      /** No key had a value: storage is absent, not misconfigured. */
      empty: boolean;
      errors: S3StorageFieldError[];
    };

/** `GET /_agent-native/file-upload/status` reports this for the "s3" slot. */
export interface S3StorageStatus {
  requirements: S3StorageRequirements;
  /**
   * "host-environment": the provider holding the "s3" slot has no `s3`
   * descriptor, so it reads its keys from the host environment only (or
   * some other mechanism the app cannot introspect) — the app cannot save
   * keys for it here. `requirements` reports the core provider's default in
   * this state and `errors` is always empty.
   */
  state: "absent" | "invalid" | "ready" | "host-environment";
  /** Keys and error codes only. Values never leave the server. */
  errors: S3StorageFieldError[];
}

/** Body of `POST /_agent-native/file-upload/s3-config`. */
export interface SaveS3StorageRequest {
  values: S3StorageValues;
}

export interface SaveS3StorageResponse {
  /** Whether the provider holding the "s3" slot now accepts the saved config. */
  configured: boolean;
}

/** 400 body of `POST /_agent-native/file-upload/s3-config`. */
export interface SaveS3StorageErrorResponse {
  error: string;
  fieldErrors: S3StorageFieldError[];
}

/**
 * Human message for one field error, shared by the save route and any
 * client-side inline validation so the wording never drifts between them.
 * The route names the first failing key with this; a form can use it per field.
 */
export function s3StorageFieldErrorMessage(error: S3StorageFieldError): string {
  switch (error.code) {
    case "missing":
      return `${error.key} is required.`;
    case "invalid-url":
      return `${error.key} must be an http:// or https:// URL.`;
    case "invalid-bucket":
      return `${error.key} must be the bucket name, not a path or URL.`;
    case "region-required":
      return `${error.key} is required for this AWS endpoint.`;
  }
}

export function isS3StorageKeyRequired(
  key: S3StorageKey,
  requirements: S3StorageRequirements,
): boolean {
  if (key === "S3_REGION") return false;
  if (key === "S3_PUBLIC_BASE_URL") {
    return requirements.publicBaseUrl === "required";
  }
  return true;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function httpUrl(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return value.replace(/\/+$/, "");
}

const AWS_REGIONAL_HOST =
  /(?:^|\.)s3[.-](?:dualstack\.)?([a-z]{2}(?:-gov)?-[a-z]+-\d+)\.amazonaws\.com(?:\.cn)?$/;
const AWS_GLOBAL_HOST = /(?:^|\.)s3\.amazonaws\.com$/;
const AWS_HOST = /\.amazonaws\.com(?:\.cn)?$/;

/**
 * AWS signs requests per region, so the "auto" default that R2 and MinIO
 * accept makes every AWS request fail signing. Read the region from the
 * endpoint host when it names one; `undefined` means the host is not AWS.
 */
export function inferS3Region(endpoint: string): string | null | undefined {
  if (!URL.canParse(endpoint)) return undefined;
  const host = new URL(endpoint).hostname.toLowerCase();
  if (!AWS_HOST.test(host)) return undefined;
  const regional = host.match(AWS_REGIONAL_HOST);
  if (regional) return regional[1]!;
  if (AWS_GLOBAL_HOST.test(host)) return "us-east-1";
  return null;
}

export function parseS3StorageConfig(
  values: S3StorageValues,
  requirements: S3StorageRequirements,
): S3StorageParseResult {
  const raw = Object.fromEntries(
    S3_STORAGE_KEYS.map((key) => [key, clean(values[key])]),
  ) as Record<S3StorageKey, string | undefined>;
  const errors: S3StorageFieldError[] = [];

  const endpoint = raw.S3_ENDPOINT ? httpUrl(raw.S3_ENDPOINT) : undefined;
  if (!raw.S3_ENDPOINT) errors.push({ key: "S3_ENDPOINT", code: "missing" });
  else if (!endpoint) errors.push({ key: "S3_ENDPOINT", code: "invalid-url" });

  const bucket = raw.S3_BUCKET;
  if (!bucket) errors.push({ key: "S3_BUCKET", code: "missing" });
  else if (/[\s/]/.test(bucket)) {
    // A slash means a path or URL was pasted where the bare name belongs.
    errors.push({ key: "S3_BUCKET", code: "invalid-bucket" });
  }

  if (!raw.S3_ACCESS_KEY_ID) {
    errors.push({ key: "S3_ACCESS_KEY_ID", code: "missing" });
  }
  if (!raw.S3_SECRET_ACCESS_KEY) {
    errors.push({ key: "S3_SECRET_ACCESS_KEY", code: "missing" });
  }

  let region = raw.S3_REGION;
  if (!region && endpoint) {
    const inferred = inferS3Region(endpoint);
    if (inferred === null) {
      errors.push({ key: "S3_REGION", code: "region-required" });
    } else {
      region = inferred ?? "auto";
    }
  }

  let publicBaseUrl: string | null = null;
  if (raw.S3_PUBLIC_BASE_URL) {
    publicBaseUrl = httpUrl(raw.S3_PUBLIC_BASE_URL);
    if (!publicBaseUrl) {
      errors.push({ key: "S3_PUBLIC_BASE_URL", code: "invalid-url" });
    }
  } else if (requirements.publicBaseUrl === "required") {
    errors.push({ key: "S3_PUBLIC_BASE_URL", code: "missing" });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      empty: S3_STORAGE_KEYS.every((key) => !raw[key]),
      errors,
    };
  }

  return {
    ok: true,
    config: {
      endpoint: endpoint!,
      bucket: bucket!,
      accessKeyId: raw.S3_ACCESS_KEY_ID!,
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY!,
      region: region ?? "auto",
      publicBaseUrl,
    },
  };
}
