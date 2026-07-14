import path from "path";

import {
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets/crypto";
import {
  getRequestContext,
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";

import { tenantFileKey } from "./tenant-files.js";

const UPLOADED_REFERENCE_PREFIX = "slides-upload:v1:";

interface UploadedReferenceDescriptor {
  kind: "slides-upload";
  version: 1;
  ownerKey: string;
  filename: string;
  handle: PrivateBlobHandle;
}

export function isHostedSlidesRuntime(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NETLIFY && env.NETLIFY !== "false" && env.NETLIFY_LOCAL !== "true") {
    return true;
  }
  if (
    (env.AWS_LAMBDA_FUNCTION_NAME ||
      env.LAMBDA_TASK_ROOT ||
      cwd === "/var/task" ||
      cwd.startsWith("/var/task/")) &&
    env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.CF_PAGES ||
    env.RENDER ||
    env.FLY_APP_NAME ||
    env.K_SERVICE,
  );
}

export async function storeUploadedReferenceBlob(args: {
  email: string;
  orgId?: string | null;
  filename: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  const existingContext = getRequestContext();
  const handle = await runWithRequestContext(
    {
      ...existingContext,
      userEmail: args.email,
      orgId: args.orgId ?? existingContext?.orgId ?? getRequestOrgId(),
    },
    async () =>
      putPrivateBlob({
        data: args.data,
        filename: args.filename,
        mimeType: args.mimeType,
        ownerEmail: args.email,
        metadata: { kind: "slides-reference-upload" },
      }),
  );
  if (!handle) return null;

  const descriptor: UploadedReferenceDescriptor = {
    kind: "slides-upload",
    version: 1,
    ownerKey: tenantFileKey(args.email),
    filename: path.basename(args.filename),
    handle,
  };
  return `${UPLOADED_REFERENCE_PREFIX}${encryptSecretValue(
    JSON.stringify(descriptor),
  )}`;
}

export async function readUploadedReferenceBlob(
  reference: string,
  email: string,
): Promise<{ data: Buffer; filename: string } | null> {
  if (!reference.startsWith(UPLOADED_REFERENCE_PREFIX)) return null;

  let descriptor: UploadedReferenceDescriptor;
  try {
    descriptor = JSON.parse(
      decryptSecretValue(reference.slice(UPLOADED_REFERENCE_PREFIX.length)),
    ) as UploadedReferenceDescriptor;
  } catch {
    throw new Error("Invalid uploaded file reference");
  }

  if (
    descriptor?.kind !== "slides-upload" ||
    descriptor.version !== 1 ||
    descriptor.ownerKey !== tenantFileKey(email) ||
    typeof descriptor.filename !== "string" ||
    descriptor.filename !== path.basename(descriptor.filename) ||
    typeof descriptor.handle?.id !== "string" ||
    typeof descriptor.handle?.provider !== "string" ||
    descriptor.handle.opaque !== true
  ) {
    throw new Error(
      "Access denied: uploaded file reference is not valid for this user",
    );
  }

  const blob = await readPrivateBlob(descriptor.handle);
  return { data: Buffer.from(blob.data), filename: descriptor.filename };
}
