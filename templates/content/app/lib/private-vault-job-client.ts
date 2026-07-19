import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { z } from "zod";

import { readBoundedResponseBytes } from "./private-vault-bounded-response.js";

const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const jobHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const jobMetadataSchema = z
  .object({
    vaultId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    epoch: positiveIntegerSchema,
    algorithmId: z.literal(E2EE_SUITE_ID),
    ciphertextByteLength: positiveIntegerSchema.max(
      E2EE_SIZE_LIMITS.jobEnvelopeBytes,
    ),
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
    state: z.enum([
      "queued",
      "leased",
      "acknowledged",
      "retry_wait",
      "cancelled",
      "completed",
      "failed",
    ]),
    retryCount: z.number().int().nonnegative().max(100),
    retryAt: protocolTimestampSchema.nullable().optional(),
    leaseExpiresAt: protocolTimestampSchema.nullable().optional(),
    serverReceivedAt: protocolTimestampSchema.optional(),
  })
  .strict();

export interface PrivateVaultJobUpload {
  vaultId: string;
  jobId: string;
  grantId: string;
  recipientEndpointId: string;
  epoch: number;
  algorithmId: string;
  issuedAt: string;
  expiresAt: string;
  ciphertext: Uint8Array;
}

export interface PrivateVaultJobMetadata {
  vaultId: string;
  jobId: string;
  grantId: string;
  recipientEndpointId: string;
  epoch: number;
  algorithmId: string;
  ciphertextByteLength: number;
  issuedAt: string;
  expiresAt: string;
  state: string;
  retryCount: number;
}

export class PrivateVaultJobTransportError extends Error {
  constructor(readonly status: number) {
    super(`Private Vault job transport failed (${status})`);
    this.name = "PrivateVaultJobTransportError";
  }
}

function positiveInteger(value: string | null): number {
  if (!value || !/^[1-9][0-9]*$/.test(value))
    throw new PrivateVaultJobTransportError(502);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new PrivateVaultJobTransportError(502);
  return parsed;
}

function invalidJobResponse(): PrivateVaultJobTransportError {
  return new PrivateVaultJobTransportError(502);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (response.headers.get("content-type") !== "application/json") {
    throw invalidJobResponse();
  }
  try {
    return await response.json();
  } catch {
    throw invalidJobResponse();
  }
}

export async function uploadPrivateVaultJob(
  input: PrivateVaultJobUpload,
  options: { signal?: AbortSignal } = {},
): Promise<PrivateVaultJobMetadata> {
  const request = jobMetadataSchema
    .omit({
      state: true,
      retryCount: true,
      retryAt: true,
      leaseExpiresAt: true,
      serverReceivedAt: true,
    })
    .parse({
      vaultId: input.vaultId,
      jobId: input.jobId,
      grantId: input.grantId,
      recipientEndpointId: input.recipientEndpointId,
      epoch: input.epoch,
      algorithmId: input.algorithmId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      ciphertextByteLength: input.ciphertext.byteLength,
    });
  const response = await fetch(agentNativePath("/api/private-vault/jobs"), {
    method: "POST",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Agent-Native-CSRF": "1",
      "X-ANC-Vault-Id": input.vaultId,
      "X-ANC-Job-Id": input.jobId,
      "X-ANC-Grant-Id": input.grantId,
      "X-ANC-Recipient-Endpoint-Id": input.recipientEndpointId,
      "X-ANC-Epoch": String(input.epoch),
      "X-ANC-Algorithm-Id": input.algorithmId,
      "X-ANC-Issued-At": input.issuedAt,
      "X-ANC-Expires-At": input.expiresAt,
      "X-ANC-Ciphertext-Byte-Length": String(input.ciphertext.byteLength),
    },
    body: new Uint8Array(input.ciphertext).buffer,
  });
  if (!response.ok) throw new PrivateVaultJobTransportError(response.status);
  const parsed = jobMetadataSchema.safeParse(await parseJsonResponse(response));
  if (
    !parsed.success ||
    parsed.data.vaultId !== request.vaultId ||
    parsed.data.jobId !== request.jobId ||
    parsed.data.grantId !== request.grantId ||
    parsed.data.recipientEndpointId !== request.recipientEndpointId ||
    parsed.data.epoch !== request.epoch ||
    parsed.data.algorithmId !== request.algorithmId ||
    parsed.data.ciphertextByteLength !== request.ciphertextByteLength ||
    parsed.data.issuedAt !== request.issuedAt ||
    parsed.data.expiresAt !== request.expiresAt
  ) {
    throw invalidJobResponse();
  }
  return parsed.data;
}

export async function getPrivateVaultJobResult(
  input: { vaultId: string; jobId: string },
  options: { signal?: AbortSignal } = {},
): Promise<{
  ciphertext: Uint8Array;
  metadata: {
    algorithmId: string;
    epoch: number;
    jobHash: string;
    state: "completed" | "failed";
    ciphertextByteLength: number;
  };
}> {
  const response = await fetch(
    agentNativePath(
      `/api/private-vault/jobs/${encodeURIComponent(input.jobId)}/result`,
    ),
    {
      method: "GET",
      credentials: "same-origin",
      signal: options.signal,
      headers: { "X-ANC-Vault-Id": input.vaultId },
    },
  );
  if (!response.ok) throw new PrivateVaultJobTransportError(response.status);
  if (response.headers.get("content-type") !== "application/octet-stream")
    throw new PrivateVaultJobTransportError(502);
  const ciphertextByteLength = positiveInteger(
    response.headers.get("x-anc-ciphertext-byte-length"),
  );
  if (ciphertextByteLength > E2EE_SIZE_LIMITS.resultEnvelopeBytes)
    throw invalidJobResponse();
  const state = response.headers.get("x-anc-job-state");
  const algorithmId = response.headers.get("x-anc-algorithm-id") ?? "";
  const jobHash = response.headers.get("x-anc-job-hash") ?? "";
  if (
    algorithmId !== E2EE_SUITE_ID ||
    !jobHashSchema.safeParse(jobHash).success ||
    (state !== "completed" && state !== "failed")
  )
    throw new PrivateVaultJobTransportError(502);
  const ciphertext = await readBoundedResponseBytes(response, {
    maximumByteLength: E2EE_SIZE_LIMITS.resultEnvelopeBytes,
    expectedByteLength: ciphertextByteLength,
    invalidResponse: invalidJobResponse,
  });
  return {
    ciphertext,
    metadata: {
      algorithmId,
      epoch: positiveInteger(response.headers.get("x-anc-epoch")),
      jobHash,
      state,
      ciphertextByteLength,
    },
  };
}
