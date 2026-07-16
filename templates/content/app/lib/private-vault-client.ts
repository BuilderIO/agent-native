import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { z } from "zod";

import { readBoundedResponseBytes } from "./private-vault-bounded-response.js";

const objectTypeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9._:-]*$/);
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const objectRevisionMetadataSchema = z
  .object({
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    objectType: objectTypeSchema,
    algorithmId: z.literal(E2EE_SUITE_ID),
    epoch: positiveIntegerSchema,
    parentRevisionIds: z.array(opaqueIdSchema).max(32),
    ciphertextByteLength: positiveIntegerSchema.max(
      E2EE_SIZE_LIMITS.objectPlaintextBytes,
    ),
    serverReceivedAt: protocolTimestampSchema.optional(),
  })
  .strict();

export interface PrivateVaultCiphertextRevisionInput {
  vaultId: string;
  objectId: string;
  revisionId: string;
  objectType: string;
  algorithmId: string;
  epoch: number;
  parentRevisionIds?: string[];
  ciphertext: Uint8Array;
}

export interface PrivateVaultCiphertextRevisionMetadata {
  vaultId: string;
  objectId: string;
  revisionId: string;
  objectType: string;
  algorithmId: string;
  epoch: number;
  parentRevisionIds: string[];
  ciphertextByteLength: number;
  serverReceivedAt?: string;
}

export class PrivateVaultTransportError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Private Vault ciphertext transport failed (${status})`);
    this.name = "PrivateVaultTransportError";
    this.status = status;
  }
}

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64UrlJson(value: string): unknown {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    ),
  );
}

function requirePositiveInteger(value: string | null): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) {
    throw new PrivateVaultTransportError(502);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PrivateVaultTransportError(502);
  return parsed;
}

function invalidTransportResponse(): PrivateVaultTransportError {
  return new PrivateVaultTransportError(502);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.headers.get("content-type") !== "application/json") {
    throw invalidTransportResponse();
  }
  try {
    return await response.json();
  } catch {
    throw invalidTransportResponse();
  }
}

function revisionUrl(objectId: string, revisionId: string) {
  return agentNativePath(
    `/api/private-vault/objects/${encodeURIComponent(objectId)}/${encodeURIComponent(revisionId)}`,
  );
}

export async function uploadPrivateVaultCiphertextRevision(
  input: PrivateVaultCiphertextRevisionInput,
  options: { signal?: AbortSignal } = {},
): Promise<PrivateVaultCiphertextRevisionMetadata> {
  const request = objectRevisionMetadataSchema
    .omit({ serverReceivedAt: true })
    .parse({
      vaultId: input.vaultId,
      objectId: input.objectId,
      revisionId: input.revisionId,
      objectType: input.objectType,
      algorithmId: input.algorithmId,
      epoch: input.epoch,
      parentRevisionIds: input.parentRevisionIds ?? [],
      ciphertextByteLength: input.ciphertext.byteLength,
    });
  const body = new Uint8Array(input.ciphertext).buffer;
  const response = await fetch(agentNativePath("/api/private-vault/objects"), {
    method: "POST",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Agent-Native-CSRF": "1",
      "X-ANC-Vault-Id": input.vaultId,
      "X-ANC-Object-Id": input.objectId,
      "X-ANC-Revision-Id": input.revisionId,
      "X-ANC-Object-Type": input.objectType,
      "X-ANC-Algorithm-Id": input.algorithmId,
      "X-ANC-Epoch": String(input.epoch),
      "X-ANC-Parent-Revision-Ids": base64UrlJson(input.parentRevisionIds ?? []),
      "X-ANC-Ciphertext-Byte-Length": String(input.ciphertext.byteLength),
    },
    body,
  });
  if (!response.ok) throw new PrivateVaultTransportError(response.status);
  const parsed = objectRevisionMetadataSchema.safeParse(
    await parseJsonResponse(response),
  );
  if (
    !parsed.success ||
    parsed.data.vaultId !== request.vaultId ||
    parsed.data.objectId !== request.objectId ||
    parsed.data.revisionId !== request.revisionId ||
    parsed.data.objectType !== request.objectType ||
    parsed.data.algorithmId !== request.algorithmId ||
    parsed.data.epoch !== request.epoch ||
    parsed.data.ciphertextByteLength !== request.ciphertextByteLength ||
    parsed.data.parentRevisionIds.length !== request.parentRevisionIds.length ||
    parsed.data.parentRevisionIds.some(
      (id, index) => id !== request.parentRevisionIds[index],
    )
  ) {
    throw invalidTransportResponse();
  }
  return parsed.data;
}

export async function getPrivateVaultCiphertextRevision(
  input: { vaultId: string; objectId: string; revisionId: string },
  options: { signal?: AbortSignal } = {},
): Promise<{
  ciphertext: Uint8Array;
  metadata: Omit<
    PrivateVaultCiphertextRevisionMetadata,
    "vaultId" | "objectId" | "revisionId"
  >;
}> {
  const response = await fetch(revisionUrl(input.objectId, input.revisionId), {
    method: "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: { "X-ANC-Vault-Id": input.vaultId },
  });
  if (!response.ok) throw new PrivateVaultTransportError(response.status);
  if (response.headers.get("content-type") !== "application/octet-stream") {
    throw new PrivateVaultTransportError(502);
  }
  const ciphertextByteLength = requirePositiveInteger(
    response.headers.get("x-anc-ciphertext-byte-length"),
  );
  if (ciphertextByteLength > E2EE_SIZE_LIMITS.objectPlaintextBytes) {
    throw new PrivateVaultTransportError(502);
  }
  let parentRevisionIds: unknown;
  try {
    parentRevisionIds = decodeBase64UrlJson(
      response.headers.get("x-anc-parent-revision-ids") ?? "",
    );
  } catch {
    throw invalidTransportResponse();
  }
  const metadata = objectRevisionMetadataSchema
    .omit({
      vaultId: true,
      objectId: true,
      revisionId: true,
      serverReceivedAt: true,
    })
    .safeParse({
      objectType: response.headers.get("x-anc-object-type") ?? "",
      algorithmId: response.headers.get("x-anc-algorithm-id") ?? "",
      epoch: requirePositiveInteger(response.headers.get("x-anc-epoch")),
      parentRevisionIds,
      ciphertextByteLength,
    });
  if (!metadata.success) throw invalidTransportResponse();
  const ciphertext = await readBoundedResponseBytes(response, {
    maximumByteLength: E2EE_SIZE_LIMITS.objectPlaintextBytes,
    expectedByteLength: ciphertextByteLength,
    invalidResponse: invalidTransportResponse,
  });
  return {
    ciphertext,
    metadata: metadata.data,
  };
}

export async function deletePrivateVaultCiphertextObject(
  input: { vaultId: string; objectId: string },
  options: { signal?: AbortSignal } = {},
): Promise<{ deleted: true }> {
  const response = await fetch(
    agentNativePath(
      `/api/private-vault/objects/${encodeURIComponent(input.objectId)}`,
    ),
    {
      method: "DELETE",
      credentials: "same-origin",
      signal: options.signal,
      headers: {
        "X-Agent-Native-CSRF": "1",
        "X-ANC-Vault-Id": input.vaultId,
      },
    },
  );
  if (!response.ok) throw new PrivateVaultTransportError(response.status);
  return { deleted: true };
}
