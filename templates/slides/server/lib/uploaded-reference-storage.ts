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

export { isHostedSlidesRuntime } from "./tenant-files.js";

const UPLOADED_REFERENCE_PREFIX = "slides-upload:v1:";

interface UploadedReferenceDescriptor {
  kind: "slides-upload";
  version: 1;
  ownerKey: string;
  orgId: string | null;
  filename: string;
  handle: PrivateBlobHandle;
}

export async function storeUploadedReferenceBlob(args: {
  email: string;
  orgId?: string | null;
  filename: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  const existingContext = getRequestContext();
  const orgId =
    args.orgId !== undefined
      ? args.orgId
      : (existingContext?.orgId ?? getRequestOrgId() ?? null);
  const handle = await runWithRequestContext(
    {
      ...existingContext,
      userEmail: args.email,
      orgId: orgId ?? undefined,
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
    orgId,
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
    console.warn("[slides-upload] invalid uploaded reference descriptor", {
      reason: "decrypt-or-parse",
    });
    throw new Error("Invalid uploaded file reference");
  }

  const requestOrgId = getRequestOrgId() ?? null;
  const ownerMatches = descriptor?.ownerKey === tenantFileKey(email);
  const orgMatches = descriptor?.orgId === requestOrgId;
  const filename = descriptor?.filename;
  const safeFilename =
    typeof filename === "string" && filename === path.basename(filename)
      ? filename
      : null;
  const handleIsOpaque = descriptor?.handle?.opaque === true;
  if (
    descriptor?.kind !== "slides-upload" ||
    descriptor?.version !== 1 ||
    !ownerMatches ||
    !orgMatches ||
    safeFilename === null ||
    typeof descriptor?.handle?.id !== "string" ||
    typeof descriptor?.handle?.provider !== "string" ||
    !handleIsOpaque
  ) {
    console.warn("[slides-upload] uploaded reference rejected", {
      handleIsOpaque,
      hasDescriptorOrg: descriptor?.orgId != null,
      hasRequestOrg: requestOrgId != null,
      orgMatches,
      ownerMatches,
      reason: "scope-or-handle-validation",
    });
    throw new Error(
      "Access denied: uploaded file reference is not valid for this user or organization",
    );
  }

  const blob = await readPrivateBlob(descriptor.handle);
  return { data: Buffer.from(blob.data), filename: safeFilename };
}
