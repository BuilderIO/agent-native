import {
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "./canonical.js";
import { ancV1Hash, ancV1VerifyDetached } from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SUITE_ID } from "./suite.js";

const FRAME_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const DISCLOSURE_KEYS = [
  1,
  2,
  3,
  4,
  5,
  E2EE_ENVELOPE_FIELDS.disclosure.grantRef,
  E2EE_ENVELOPE_FIELDS.disclosure.providerId,
  E2EE_ENVELOPE_FIELDS.disclosure.destination,
  E2EE_ENVELOPE_FIELDS.disclosure.scopeHash,
  E2EE_ENVELOPE_FIELDS.disclosure.issuedAt,
  E2EE_ENVELOPE_FIELDS.disclosure.expiresAt,
  E2EE_ENVELOPE_FIELDS.disclosure.signature,
] as const;
const MAXIMUM_BYTES = 96 * 1024;
const TOKEN = /^[\x21-\x7e]{1,160}$/;

export class AncV1BrokerDisclosureError extends Error {
  constructor() {
    super("anc/v1 broker disclosure is invalid");
    this.name = "AncV1BrokerDisclosureError";
  }
}

export interface AncV1BrokerDisclosureRequest {
  readonly version: 1;
  readonly suite: "anc/v1";
  readonly type: "broker-disclosure-request";
  readonly vaultId: string;
  readonly endpointId: string;
  readonly jobId: string;
  readonly grantId: string;
  readonly resourceId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly destination: string;
  readonly outcome: "allowed" | "failed";
  readonly signedEnvelope: Uint8Array;
}

export interface VerifiedAncV1BrokerDisclosure extends AncV1BrokerDisclosureRequest {
  readonly disclosureId: string;
  readonly grantRef: string;
  readonly scopeHash: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface AncV1BrokerDisclosureResponse {
  readonly version: 1;
  readonly suite: "anc/v1";
  readonly type: "broker-disclosure-response";
  readonly disclosureId: string;
  readonly state: "stored";
}

function fail(): never {
  throw new AncV1BrokerDisclosureError();
}

function bytes(value: AncV1CanonicalValue | undefined, length: number) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail();
  return value.slice();
}

function text(value: AncV1CanonicalValue | undefined): string {
  if (typeof value !== "string" || !TOKEN.test(value)) fail();
  return value;
}

function positive(value: AncV1CanonicalValue | undefined): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail();
  return value as number;
}

function id(value: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(value)) fail();
  return ancV1HexToBytes(value);
}

function request(input: AncV1BrokerDisclosureRequest) {
  if (
    input.version !== 1 ||
    input.suite !== E2EE_SUITE_ID ||
    input.type !== "broker-disclosure-request" ||
    !TOKEN.test(input.operation) ||
    !TOKEN.test(input.providerId) ||
    !TOKEN.test(input.destination) ||
    (input.outcome !== "allowed" && input.outcome !== "failed") ||
    !(input.signedEnvelope instanceof Uint8Array) ||
    input.signedEnvelope.byteLength === 0 ||
    input.signedEnvelope.byteLength > 64 * 1024
  )
    fail();
  return {
    vaultId: id(input.vaultId),
    endpointId: id(input.endpointId),
    jobId: id(input.jobId),
    grantId: id(input.grantId),
    resourceId: id(input.resourceId),
  };
}

export function encodeAncV1BrokerDisclosureRequest(
  input: AncV1BrokerDisclosureRequest,
): Uint8Array {
  const ids = request(input);
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [1, E2EE_SUITE_ID],
      [2, "broker-disclosure-request"],
      [3, ids.vaultId],
      [4, ids.endpointId],
      [5, ids.jobId],
      [6, ids.grantId],
      [7, ids.resourceId],
      [8, input.operation],
      [9, input.providerId],
      [10, input.destination],
      [11, input.outcome],
      [12, input.signedEnvelope.slice()],
      [13, 1],
      [14, 0],
      [15, 0],
    ]),
  );
  if (encoded.byteLength > MAXIMUM_BYTES) fail();
  return encoded;
}

export function decodeAncV1BrokerDisclosureRequest(
  encoded: Uint8Array,
): AncV1BrokerDisclosureRequest {
  try {
    const map = decodeAncV1Envelope(encoded, FRAME_KEYS, {
      maxBytes: MAXIMUM_BYTES,
    });
    if (
      map.get(1) !== E2EE_SUITE_ID ||
      map.get(2) !== "broker-disclosure-request" ||
      map.get(13) !== 1 ||
      map.get(14) !== 0 ||
      map.get(15) !== 0
    )
      fail();
    const outcome = text(map.get(11));
    const signedEnvelope = map.get(12);
    if (
      (outcome !== "allowed" && outcome !== "failed") ||
      !(signedEnvelope instanceof Uint8Array) ||
      signedEnvelope.byteLength === 0 ||
      signedEnvelope.byteLength > 64 * 1024
    )
      fail();
    return Object.freeze({
      version: 1,
      suite: "anc/v1",
      type: "broker-disclosure-request",
      vaultId: ancV1BytesToHex(bytes(map.get(3), 16)),
      endpointId: ancV1BytesToHex(bytes(map.get(4), 16)),
      jobId: ancV1BytesToHex(bytes(map.get(5), 16)),
      grantId: ancV1BytesToHex(bytes(map.get(6), 16)),
      resourceId: ancV1BytesToHex(bytes(map.get(7), 16)),
      operation: text(map.get(8)),
      providerId: text(map.get(9)),
      destination: text(map.get(10)),
      outcome,
      signedEnvelope: signedEnvelope.slice(),
    });
  } catch (error) {
    if (error instanceof AncV1BrokerDisclosureError) throw error;
    return fail();
  }
}

export function encodeAncV1BrokerDisclosureResponse(
  input: AncV1BrokerDisclosureResponse,
): Uint8Array {
  if (
    input.version !== 1 ||
    input.suite !== E2EE_SUITE_ID ||
    input.type !== "broker-disclosure-response" ||
    input.state !== "stored"
  )
    fail();
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [1, E2EE_SUITE_ID],
      [2, "broker-disclosure-response"],
      [3, id(input.disclosureId)],
      [4, "stored"],
    ]),
  );
}

export function decodeAncV1BrokerDisclosureResponse(
  encoded: Uint8Array,
): AncV1BrokerDisclosureResponse {
  try {
    const map = decodeAncV1Envelope(encoded, [1, 2, 3, 4], {
      maxBytes: 1024,
    });
    if (
      map.get(1) !== E2EE_SUITE_ID ||
      map.get(2) !== "broker-disclosure-response" ||
      map.get(4) !== "stored"
    )
      fail();
    return Object.freeze({
      version: 1,
      suite: "anc/v1",
      type: "broker-disclosure-response",
      disclosureId: ancV1BytesToHex(bytes(map.get(3), 16)),
      state: "stored",
    });
  } catch (error) {
    if (error instanceof AncV1BrokerDisclosureError) throw error;
    return fail();
  }
}

export async function verifyAncV1BrokerDisclosure(input: {
  readonly request: AncV1BrokerDisclosureRequest;
  readonly brokerSigningPublicKey: Uint8Array;
  readonly nowSeconds: number;
}): Promise<VerifiedAncV1BrokerDisclosure> {
  try {
    const ids = request(input.request);
    if (
      !(input.brokerSigningPublicKey instanceof Uint8Array) ||
      input.brokerSigningPublicKey.byteLength !== 32 ||
      !Number.isSafeInteger(input.nowSeconds) ||
      input.nowSeconds <= 0
    )
      fail();
    const map = decodeAncV1Envelope(
      input.request.signedEnvelope,
      DISCLOSURE_KEYS,
      { maxBytes: 64 * 1024 },
    );
    const fields = E2EE_ENVELOPE_FIELDS.disclosure;
    const vaultId = bytes(map.get(2), 16);
    const disclosureId = bytes(map.get(5), 16);
    const grantRef = bytes(map.get(fields.grantRef), 32);
    const providerId = text(map.get(fields.providerId));
    const destination = text(map.get(fields.destination));
    const scopeHash = bytes(map.get(fields.scopeHash), 32);
    const issuedAt = positive(map.get(fields.issuedAt));
    const expiresAt = positive(map.get(fields.expiresAt));
    const signature = bytes(map.get(fields.signature), 64);
    if (
      map.get(1) !== E2EE_SUITE_ID ||
      map.get(3) !== "disclosure" ||
      positive(map.get(4)) > issuedAt ||
      expiresAt <= issuedAt ||
      input.nowSeconds > expiresAt ||
      ancV1BytesToHex(vaultId) !== input.request.vaultId ||
      providerId !== input.request.providerId ||
      destination !== input.request.destination
    )
      fail();
    const unsigned = new Map(map);
    unsigned.delete(fields.signature);
    const unsignedBytes = encodeAncV1Canonical(unsigned);
    const validSignature = await ancV1VerifyDetached(
      "disclosure",
      unsignedBytes,
      signature,
      input.brokerSigningPublicKey,
    );
    const expectedScopeHash = await ancV1Hash(
      "disclosure",
      encodeAncV1Canonical([ids.resourceId, input.request.operation]),
    );
    if (
      !validSignature ||
      ancV1BytesToHex(expectedScopeHash) !== ancV1BytesToHex(scopeHash)
    )
      fail();
    return Object.freeze({
      ...input.request,
      signedEnvelope: input.request.signedEnvelope.slice(),
      disclosureId: ancV1BytesToHex(disclosureId),
      grantRef: ancV1BytesToHex(grantRef),
      scopeHash: ancV1BytesToHex(scopeHash),
      issuedAt,
      expiresAt,
    });
  } catch (error) {
    if (error instanceof AncV1BrokerDisclosureError) throw error;
    return fail();
  }
}
