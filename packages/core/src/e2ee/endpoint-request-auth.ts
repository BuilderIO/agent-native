import { z } from "zod";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  encodeAncV1Canonical,
} from "./canonical.js";
import { opaqueIdSchema, protocolTimestampSchema } from "./contracts.js";
import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import { E2EE_LIFETIME_LIMITS_SECONDS, E2EE_SUITE_ID } from "./suite.js";

export const E2EE_ENDPOINT_REQUEST_MAX_AGE_SECONDS = 5 * 60;
export const E2EE_ENDPOINT_REQUEST_MAX_FUTURE_SKEW_SECONDS = 30;
/** A nonce outlives its proof's acceptance window so the exact boundary cannot replay. */
export const E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS = 6 * 60;

export const endpointRequestMethodSchema = z.enum([
  "GET",
  "POST",
  "PATCH",
  "DELETE",
]);

const canonicalEndpointRequestPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/)
  .superRefine((path, ctx) => {
    const segments = path.split("/");
    if (
      path.includes("//") ||
      path.includes("\\") ||
      segments.includes(".") ||
      segments.includes("..")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Request path must use one canonical absolute-path form",
      });
    }
  });

const lowercaseHex = (bytes: number) =>
  z
    .string()
    .length(bytes * 2)
    .regex(/^[0-9a-f]+$/);

export const endpointRequestUnsignedProofSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("endpoint_request"),
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    method: endpointRequestMethodSchema,
    path: canonicalEndpointRequestPathSchema,
    bodyHash: lowercaseHex(32),
    issuedAt: protocolTimestampSchema,
    nonce: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[0-9a-f]+$/),
  })
  .strict();

export const endpointRequestProofSchema = endpointRequestUnsignedProofSchema
  .extend({ signature: lowercaseHex(64) })
  .strict();

export type EndpointRequestUnsignedProof = z.infer<
  typeof endpointRequestUnsignedProofSchema
>;
export type EndpointRequestProof = z.infer<typeof endpointRequestProofSchema>;

export const authorizedEndpointRequestIdentitySchema = z
  .object({
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    role: z.literal("broker"),
    state: z.literal("active"),
    signingPublicKey: z
      .instanceof(Uint8Array)
      .refine((key) => key.length === 32),
    authenticatedControlHead: z
      .object({
        sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        hash: lowercaseHex(32),
        verifiedAt: protocolTimestampSchema,
      })
      .strict(),
  })
  .strict();

export type AuthorizedEndpointRequestIdentity = z.infer<
  typeof authorizedEndpointRequestIdentitySchema
>;

export type EndpointRequestAuthFailureCode =
  | "invalid_proof"
  | "request_mismatch"
  | "expired"
  | "future"
  | "unauthorized_endpoint"
  | "invalid_signature"
  | "replay";

export class EndpointRequestAuthError extends Error {
  readonly code: EndpointRequestAuthFailureCode;

  constructor(code: EndpointRequestAuthFailureCode) {
    super("Endpoint request authentication failed");
    this.name = "EndpointRequestAuthError";
    this.code = code;
  }
}

export function encodeEndpointRequestUnsignedProof(
  proof: EndpointRequestUnsignedProof,
): Uint8Array {
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [1, proof.suite],
      [2, proof.version],
      [3, proof.type],
      [4, proof.vaultId],
      [5, proof.endpointId],
      [6, proof.method],
      [7, proof.path],
      [8, ancV1HexToBytes(proof.bodyHash)],
      [9, proof.issuedAt],
      [10, proof.nonce],
    ]),
  );
}

async function bodyHash(body: Uint8Array): Promise<string> {
  return ancV1BytesToHex(await ancV1Hash("endpoint-request-body", body));
}

export async function createEndpointRequestProof(input: {
  vaultId: string;
  endpointId: string;
  method: z.input<typeof endpointRequestMethodSchema>;
  path: string;
  body: Uint8Array;
  issuedAt: string;
  nonce: string;
  signingPrivateKey: Uint8Array;
}): Promise<EndpointRequestProof> {
  if (!(input.body instanceof Uint8Array)) {
    throw new EndpointRequestAuthError("invalid_proof");
  }
  const unsigned = endpointRequestUnsignedProofSchema.parse({
    version: 1,
    suite: E2EE_SUITE_ID,
    type: "endpoint_request",
    vaultId: input.vaultId,
    endpointId: input.endpointId,
    method: input.method,
    path: input.path,
    bodyHash: await bodyHash(input.body),
    issuedAt: input.issuedAt,
    nonce: input.nonce,
  });
  const signature = await ancV1SignDetached(
    "endpoint-request",
    encodeEndpointRequestUnsignedProof(unsigned),
    input.signingPrivateKey,
  );
  return endpointRequestProofSchema.parse({
    ...unsigned,
    signature: ancV1BytesToHex(signature),
  });
}

export interface EndpointRequestNonceClaim {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly nonce: string;
  readonly expiresAt: string;
}

export interface VerifyEndpointRequestProofInput {
  readonly proof: unknown;
  readonly expectedMethod: z.input<typeof endpointRequestMethodSchema>;
  readonly expectedPath: string;
  readonly body: Uint8Array;
  readonly now: Date;
  /** Resolves only a broker authorized by the currently verified signed control head. */
  readonly resolveAuthorizedEndpoint: (identity: {
    vaultId: string;
    endpointId: string;
    requiredRole: "broker";
    now: Date;
  }) => Promise<AuthorizedEndpointRequestIdentity | null>;
  /** Atomically returns true only for the first claim of this nonce. */
  readonly claimNonce: (claim: EndpointRequestNonceClaim) => Promise<boolean>;
}

export async function verifyEndpointRequestProof(
  input: VerifyEndpointRequestProofInput,
): Promise<{ vaultId: string; endpointId: string }> {
  if (
    !(input.body instanceof Uint8Array) ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new EndpointRequestAuthError("request_mismatch");
  }
  const parsed = endpointRequestProofSchema.safeParse(input.proof);
  if (!parsed.success) throw new EndpointRequestAuthError("invalid_proof");
  const proof = parsed.data;

  let expectedMethod: z.infer<typeof endpointRequestMethodSchema>;
  let expectedPath: string;
  try {
    expectedMethod = endpointRequestMethodSchema.parse(input.expectedMethod);
    expectedPath = canonicalEndpointRequestPathSchema.parse(input.expectedPath);
  } catch {
    throw new EndpointRequestAuthError("request_mismatch");
  }
  if (proof.method !== expectedMethod || proof.path !== expectedPath) {
    throw new EndpointRequestAuthError("request_mismatch");
  }

  const expectedBodyHash = await bodyHash(input.body);
  if (proof.bodyHash !== expectedBodyHash) {
    throw new EndpointRequestAuthError("request_mismatch");
  }

  const issuedAtMs = Date.parse(proof.issuedAt);
  const nowMs = input.now.getTime();
  if (nowMs - issuedAtMs >= E2EE_ENDPOINT_REQUEST_MAX_AGE_SECONDS * 1000) {
    throw new EndpointRequestAuthError("expired");
  }
  if (
    issuedAtMs - nowMs >
    E2EE_ENDPOINT_REQUEST_MAX_FUTURE_SKEW_SECONDS * 1000
  ) {
    throw new EndpointRequestAuthError("future");
  }

  const resolvedIdentity = await input.resolveAuthorizedEndpoint({
    vaultId: proof.vaultId,
    endpointId: proof.endpointId,
    requiredRole: "broker",
    now: input.now,
  });
  const identity =
    authorizedEndpointRequestIdentitySchema.safeParse(resolvedIdentity);
  const verifiedAtMs = identity.success
    ? Date.parse(identity.data.authenticatedControlHead.verifiedAt)
    : Number.NaN;
  if (
    !identity.success ||
    identity.data.vaultId !== proof.vaultId ||
    identity.data.endpointId !== proof.endpointId ||
    verifiedAtMs > nowMs ||
    nowMs - verifiedAtMs >=
      E2EE_LIFETIME_LIMITS_SECONDS.brokerAuthorizationFreshness * 1000
  ) {
    throw new EndpointRequestAuthError("unauthorized_endpoint");
  }

  const { signature, ...unsigned } = proof;
  let validSignature = false;
  try {
    validSignature = await ancV1VerifyDetached(
      "endpoint-request",
      encodeEndpointRequestUnsignedProof(unsigned),
      ancV1HexToBytes(signature),
      identity.data.signingPublicKey,
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    throw new EndpointRequestAuthError("invalid_signature");
  }

  const claimed = await input.claimNonce({
    vaultId: proof.vaultId,
    endpointId: proof.endpointId,
    nonce: proof.nonce,
    expiresAt: new Date(
      issuedAtMs + E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS * 1000,
    ).toISOString(),
  });
  if (!claimed) throw new EndpointRequestAuthError("replay");

  return { vaultId: proof.vaultId, endpointId: proof.endpointId };
}
