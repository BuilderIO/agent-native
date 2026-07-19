import { z } from "zod";

import {
  decodeAncV1Envelope,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "./canonical.js";
import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  E2EE_LIFETIME_LIMITS_SECONDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const ID_BYTES = 16;
const HASH_BYTES = 32;
const SIGNATURE_BYTES = 64;
const SAFE_POSITIVE = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const TOKEN = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9._:-]*$/);
const grantKeys = [
  1, 2, 3, 4, 5, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
] as const;
const revokeKeys = [1, 2, 3, 4, 5, 72, 73, 74, 75, 76, 77] as const;

export class AncV1GrantCodecError extends Error {
  constructor() {
    super("anc/v1 capability grant is invalid");
    this.name = "AncV1GrantCodecError";
  }
}

export interface AncV1GrantCoordinates {
  readonly vaultId: Uint8Array;
  readonly envelopeId: Uint8Array;
  readonly createdAt: number;
  readonly grantId: Uint8Array;
  readonly issuerEndpointId: Uint8Array;
  readonly subjectAccountId: Uint8Array;
  readonly subjectEndpointId: Uint8Array;
  readonly subjectAgentId: Uint8Array | null;
  readonly resourceIds: readonly Uint8Array[];
  readonly operations: readonly string[];
  readonly providers: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revocationRef: Uint8Array;
}

export interface AncV1DecodedGrant extends AncV1GrantCoordinates {
  readonly grantRef: Uint8Array;
}

function fail(): never {
  throw new AncV1GrantCodecError();
}

function exact(value: unknown, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail();
  return value.slice();
}

function positive(value: unknown): number {
  const parsed = SAFE_POSITIVE.safeParse(value);
  if (!parsed.success) fail();
  return parsed.data;
}

function orderedBytes(value: unknown, maximum: number): Uint8Array[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum)
    fail();
  const result = value.map((item) => exact(item, ID_BYTES));
  for (let index = 1; index < result.length; index += 1) {
    const left = result[index - 1]!;
    const right = result[index]!;
    let comparison = 0;
    for (let offset = 0; offset < ID_BYTES && comparison === 0; offset += 1)
      comparison = left[offset]! - right[offset]!;
    if (comparison >= 0) fail();
  }
  return result;
}

function orderedTokens(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum)
    fail();
  const result = value.map((item) => {
    const parsed = TOKEN.safeParse(item);
    if (!parsed.success) fail();
    return parsed.data;
  });
  if (result.some((item, index) => index > 0 && result[index - 1]! >= item))
    fail();
  return result;
}

function common(
  type: "grant" | "grant-revoke",
  input: { vaultId: Uint8Array; envelopeId: Uint8Array; createdAt: number },
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [1, E2EE_SUITE_ID],
    [2, exact(input.vaultId, ID_BYTES)],
    [3, type],
    [4, positive(input.createdAt)],
    [5, exact(input.envelopeId, ID_BYTES)],
  ]);
}

export async function sealAncV1Grant(
  input: AncV1GrantCoordinates & { readonly signingPrivateKey: Uint8Array },
): Promise<Uint8Array> {
  try {
    const issuedAt = positive(input.issuedAt);
    const expiresAt = positive(input.expiresAt);
    if (
      expiresAt <= issuedAt ||
      expiresAt - issuedAt >
        E2EE_LIFETIME_LIMITS_SECONDS.internalGrantMaximum ||
      input.createdAt > issuedAt
    )
      fail();
    const unsigned = common("grant", input);
    unsigned.set(60, exact(input.grantId, ID_BYTES));
    unsigned.set(61, exact(input.issuerEndpointId, ID_BYTES));
    unsigned.set(62, exact(input.subjectAccountId, ID_BYTES));
    unsigned.set(63, exact(input.subjectEndpointId, ID_BYTES));
    unsigned.set(
      64,
      input.subjectAgentId === null
        ? null
        : exact(input.subjectAgentId, ID_BYTES),
    );
    unsigned.set(65, orderedBytes(input.resourceIds, 256));
    unsigned.set(66, orderedTokens(input.operations, 128));
    unsigned.set(67, orderedTokens(input.providers, 64));
    unsigned.set(68, issuedAt);
    unsigned.set(69, expiresAt);
    unsigned.set(70, exact(input.revocationRef, ID_BYTES));
    const signature = await ancV1SignDetached(
      "grant",
      encodeAncV1Canonical(unsigned),
      input.signingPrivateKey,
    );
    const signed = new Map(unsigned);
    signed.set(71, signature);
    const encoded = encodeAncV1Canonical(signed);
    if (encoded.byteLength > E2EE_SIZE_LIMITS.controlEnvelopeBytes) fail();
    return encoded;
  } catch {
    return fail();
  }
}

export async function decodeAndVerifyAncV1Grant(input: {
  readonly encoded: Uint8Array;
  readonly expectedVaultId: Uint8Array;
  readonly nowSeconds: number;
  readonly resolveIssuerSigningPublicKey: (
    issuerEndpointId: Uint8Array,
  ) => Promise<Uint8Array | null> | Uint8Array | null;
}): Promise<AncV1DecodedGrant> {
  try {
    const map = decodeAncV1Envelope(input.encoded, grantKeys, {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    });
    if (
      map.size !== grantKeys.length ||
      map.get(1) !== E2EE_SUITE_ID ||
      map.get(3) !== "grant"
    )
      fail();
    const vaultId = exact(map.get(2), ID_BYTES);
    if (
      !vaultId.every((byte, index) => byte === input.expectedVaultId[index]) ||
      input.expectedVaultId.byteLength !== ID_BYTES
    )
      fail();
    const createdAt = positive(map.get(4));
    const envelopeId = exact(map.get(5), ID_BYTES);
    const grantId = exact(map.get(60), ID_BYTES);
    const issuerEndpointId = exact(map.get(61), ID_BYTES);
    const subjectAccountId = exact(map.get(62), ID_BYTES);
    const subjectEndpointId = exact(map.get(63), ID_BYTES);
    const agent = map.get(64);
    const subjectAgentId = agent === null ? null : exact(agent, ID_BYTES);
    const resourceIds = orderedBytes(map.get(65), 256);
    const operations = orderedTokens(map.get(66), 128);
    const providers = orderedTokens(map.get(67), 64);
    const issuedAt = positive(map.get(68));
    const expiresAt = positive(map.get(69));
    const now = positive(input.nowSeconds);
    if (
      createdAt > issuedAt ||
      expiresAt <= issuedAt ||
      now < issuedAt ||
      now > expiresAt ||
      expiresAt - issuedAt > E2EE_LIFETIME_LIMITS_SECONDS.internalGrantMaximum
    )
      fail();
    const revocationRef = exact(map.get(70), ID_BYTES);
    const signature = exact(map.get(71), SIGNATURE_BYTES);
    const unsigned = new Map(map);
    unsigned.delete(71);
    const signingPublicKey = await input.resolveIssuerSigningPublicKey(
      issuerEndpointId.slice(),
    );
    if (
      signingPublicKey === null ||
      !(await ancV1VerifyDetached(
        "grant",
        encodeAncV1Canonical(unsigned),
        signature,
        signingPublicKey,
      ))
    )
      fail();
    return {
      vaultId,
      envelopeId,
      createdAt,
      grantId,
      issuerEndpointId,
      subjectAccountId,
      subjectEndpointId,
      subjectAgentId,
      resourceIds,
      operations,
      providers,
      issuedAt,
      expiresAt,
      revocationRef,
      grantRef: await ancV1Hash("grant", input.encoded),
    };
  } catch {
    return fail();
  }
}

export interface AncV1GrantRevocationCoordinates {
  readonly vaultId: Uint8Array;
  readonly envelopeId: Uint8Array;
  readonly createdAt: number;
  readonly grantRef: Uint8Array;
  readonly revocationRef: Uint8Array;
  readonly revokedAt: number;
  readonly reason: string;
  readonly issuerEndpointId: Uint8Array;
}

export async function sealAncV1GrantRevocation(
  input: AncV1GrantRevocationCoordinates & {
    readonly signingPrivateKey: Uint8Array;
  },
): Promise<Uint8Array> {
  try {
    const revokedAt = positive(input.revokedAt);
    if (input.createdAt > revokedAt) fail();
    const reason = TOKEN.safeParse(input.reason);
    if (!reason.success) fail();
    const unsigned = common("grant-revoke", input);
    unsigned.set(72, exact(input.grantRef, HASH_BYTES));
    unsigned.set(73, exact(input.revocationRef, ID_BYTES));
    unsigned.set(74, revokedAt);
    unsigned.set(75, reason.data);
    unsigned.set(76, exact(input.issuerEndpointId, ID_BYTES));
    const signature = await ancV1SignDetached(
      "grant-revoke",
      encodeAncV1Canonical(unsigned),
      input.signingPrivateKey,
    );
    const signed = new Map(unsigned);
    signed.set(77, signature);
    const encoded = encodeAncV1Canonical(signed);
    // Current fields are fixed-size or TOKEN-bounded, so this is deliberately
    // defense in depth for future schema growth rather than a reachable v1
    // boundary. The embedded-control-log budget is tested separately.
    if (encoded.byteLength > E2EE_SIZE_LIMITS.controlEnvelopeBytes) fail();
    return encoded;
  } catch {
    return fail();
  }
}

export async function decodeAndVerifyAncV1GrantRevocation(input: {
  readonly encoded: Uint8Array;
  readonly expectedVaultId: Uint8Array;
  readonly expectedGrant: Pick<
    AncV1DecodedGrant,
    "grantRef" | "revocationRef" | "issuerEndpointId" | "issuedAt"
  >;
  readonly resolveIssuerSigningPublicKey: (
    issuerEndpointId: Uint8Array,
  ) => Promise<Uint8Array | null> | Uint8Array | null;
}): Promise<AncV1GrantRevocationCoordinates> {
  try {
    const map = decodeAncV1Envelope(input.encoded, revokeKeys, {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    });
    if (
      map.size !== revokeKeys.length ||
      map.get(1) !== E2EE_SUITE_ID ||
      map.get(3) !== "grant-revoke"
    )
      fail();
    const vaultId = exact(map.get(2), ID_BYTES);
    const envelopeId = exact(map.get(5), ID_BYTES);
    const createdAt = positive(map.get(4));
    const grantRef = exact(map.get(72), HASH_BYTES);
    const revocationRef = exact(map.get(73), ID_BYTES);
    const revokedAt = positive(map.get(74));
    const reason = TOKEN.safeParse(map.get(75));
    const issuerEndpointId = exact(map.get(76), ID_BYTES);
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.byteLength === b.byteLength &&
      a.every((byte, index) => byte === b[index]);
    if (
      !same(vaultId, exact(input.expectedVaultId, ID_BYTES)) ||
      !same(grantRef, input.expectedGrant.grantRef) ||
      !same(revocationRef, input.expectedGrant.revocationRef) ||
      !same(issuerEndpointId, input.expectedGrant.issuerEndpointId) ||
      !reason.success ||
      createdAt > revokedAt ||
      revokedAt < input.expectedGrant.issuedAt
    )
      fail();
    const signature = exact(map.get(77), SIGNATURE_BYTES);
    const unsigned = new Map(map);
    unsigned.delete(77);
    const key = await input.resolveIssuerSigningPublicKey(
      issuerEndpointId.slice(),
    );
    if (
      key === null ||
      !(await ancV1VerifyDetached(
        "grant-revoke",
        encodeAncV1Canonical(unsigned),
        signature,
        key,
      ))
    )
      fail();
    return {
      vaultId,
      envelopeId,
      createdAt,
      grantRef,
      revocationRef,
      revokedAt,
      reason: reason.data,
      issuerEndpointId,
    };
  } catch {
    return fail();
  }
}
