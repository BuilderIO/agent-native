import {
  assertCredentialCanReachEndpoint,
  type CredentialEndpointOwner,
} from "@agent-native/core/credentials";
import {
  cancelS3ResponseBody,
  readS3ErrorText,
  signedS3Request,
  type FileUploadProvider,
} from "@agent-native/core/file-upload";
import {
  resolveSecretDetailed,
  type ResolvedSecretDetail,
} from "@agent-native/core/server";

interface S3Secret {
  value: string;
  owner: CredentialEndpointOwner;
}

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeyIdOwner: CredentialEndpointOwner;
  secretAccessKey: string;
  secretAccessKeyOwner: CredentialEndpointOwner;
  endpoint: string;
  endpointOwner: CredentialEndpointOwner;
  publicBaseUrl: string | null;
}

function cleanValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function buildS3Config(values: {
  bucket?: S3Secret;
  accessKeyId?: S3Secret;
  secretAccessKey?: S3Secret;
  endpoint?: S3Secret;
  region?: string;
  publicBaseUrl?: string;
}): S3Config | null {
  const bucket = cleanValue(values.bucket?.value);
  const accessKeyId = cleanValue(values.accessKeyId?.value);
  const secretAccessKey = cleanValue(values.secretAccessKey?.value);
  const endpoint = cleanValue(values.endpoint?.value);
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  return {
    region: cleanValue(values.region) ?? "auto",
    bucket,
    accessKeyId,
    accessKeyIdOwner: values.accessKeyId!.owner,
    secretAccessKey,
    secretAccessKeyOwner: values.secretAccessKey!.owner,
    endpoint: endpoint.replace(/\/+$/, ""),
    endpointOwner: values.endpoint!.owner,
    publicBaseUrl:
      cleanValue(values.publicBaseUrl)?.replace(/\/+$/, "") ?? null,
  };
}

function deploymentSecret(
  value: string | null | undefined,
): S3Secret | undefined {
  const cleaned = cleanValue(value);
  return cleaned
    ? { value: cleaned, owner: { scope: "deployment" } }
    : undefined;
}

function resolvedS3Secret(detail: ResolvedSecretDetail): S3Secret | undefined {
  const value = cleanValue(detail.value);
  if (!value) return undefined;
  return {
    value,
    owner: {
      scope:
        detail.source === "env" ? "deployment" : (detail.source ?? "unknown"),
      ...(detail.scopeId ? { scopeId: detail.scopeId } : {}),
    },
  };
}

function readS3EnvConfig(): S3Config | null {
  const env = process.env;
  return buildS3Config({
    bucket: deploymentSecret(env.S3_BUCKET || env.R2_BUCKET),
    accessKeyId: deploymentSecret(env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID),
    secretAccessKey: deploymentSecret(
      env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY,
    ),
    endpoint: deploymentSecret(env.S3_ENDPOINT || env.R2_ENDPOINT),
    region: env.S3_REGION || env.R2_REGION,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || env.R2_PUBLIC_BASE_URL,
  });
}

async function resolveS3Secret(
  primary: string,
  fallback: string,
): Promise<S3Secret | undefined> {
  let lookupFailure: unknown;
  for (const key of [primary, fallback]) {
    try {
      const resolved = await resolveSecretDetailed(key);
      const secret = resolvedS3Secret(resolved);
      if (secret) return secret;
      if (resolved.lookupFailed) {
        lookupFailure ??=
          resolved.cause ?? new Error(`Unable to read configured ${key}`);
      }
    } catch (error) {
      lookupFailure ??= error;
    }
  }
  if (lookupFailure) throw lookupFailure;
  return undefined;
}

async function readS3Config(): Promise<S3Config | null> {
  return buildS3Config({
    bucket: await resolveS3Secret("S3_BUCKET", "R2_BUCKET"),
    accessKeyId: await resolveS3Secret("S3_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
    secretAccessKey: await resolveS3Secret(
      "S3_SECRET_ACCESS_KEY",
      "R2_SECRET_ACCESS_KEY",
    ),
    endpoint: await resolveS3Secret("S3_ENDPOINT", "R2_ENDPOINT"),
    region: (await resolveS3Secret("S3_REGION", "R2_REGION"))?.value,
    publicBaseUrl: (
      await resolveS3Secret("S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL")
    )?.value,
  });
}

const S3_PUT_TIMEOUT_MS = 120_000;

async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  assertCredentialCanReachEndpoint(
    cfg.endpointOwner,
    cfg.accessKeyIdOwner,
    "S3_ACCESS_KEY_ID",
  );
  assertCredentialCanReachEndpoint(
    cfg.endpointOwner,
    cfg.secretAccessKeyOwner,
    "S3_SECRET_ACCESS_KEY",
  );

  const res = await signedS3Request(cfg, key, {
    method: "PUT",
    body,
    contentType,
    timeoutMs: S3_PUT_TIMEOUT_MS,
  });

  if (!res.ok) {
    const text = await readS3ErrorText(res);
    throw new Error(
      `S3 PutObject failed (${res.status}): ${text || res.statusText}`,
    );
  }
  await cancelS3ResponseBody(res);

  return cfg.publicBaseUrl
    ? `${cfg.publicBaseUrl}/${key}`
    : `${cfg.endpoint}/${cfg.bucket}/${key}`;
}

export const s3FileUploadProvider: FileUploadProvider = {
  id: "s3",
  name: "S3-compatible storage",
  isConfigured: () => readS3EnvConfig() !== null,
  isConfiguredForRequest: async () => (await readS3Config()) !== null,
  upload: async ({ data, filename, mimeType }) => {
    const cfg = await readS3Config();
    if (!cfg) throw new Error("S3 credentials are not configured");

    const ext = filename?.split(".").pop() ?? "bin";
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    const objectKey = `replays/${stamp}-${rand}.${ext}`;
    const contentType = mimeType || "application/octet-stream";

    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data as unknown as ArrayBuffer);

    const publicUrl = await putObject(cfg, objectKey, bytes, contentType);
    return { url: publicUrl, provider: "s3" };
  },
};
