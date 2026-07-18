import { z } from "zod";

import {
  ancV1BytesToHex,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "./canonical.js";
import {
  ancV1BoxDecrypt,
  ancV1BoxEncrypt,
  ancV1Hash,
  ancV1PackNonceCiphertext,
  ancV1SignDetached,
  ancV1UnpackNonceCiphertext,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const SAFE_POSITIVE = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ID_BYTES = 16;
const HASH_BYTES = 32;
const NONCE_BYTES = 24;
const SIGNATURE_BYTES = 64;
const jobKeys = [1, 2, 3, 4, 5, 90, 91, 92, 93, 94, 95, 96] as const;
const resultKeys = [1, 2, 3, 4, 5, 100, 101, 102, 103, 104, 105] as const;

export class AncV1JobEnvelopeError extends Error {
  constructor() {
    super("anc/v1 encrypted job envelope is invalid");
    this.name = "AncV1JobEnvelopeError";
  }
}

export interface AncV1JobEnvelopeCoordinates {
  readonly vaultId: Uint8Array;
  readonly envelopeId: Uint8Array;
  readonly createdAt: number;
  readonly jobId: Uint8Array;
  readonly grantRef: Uint8Array;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly recipientEndpointId: Uint8Array;
}

export interface SealAncV1JobEnvelopeInput extends AncV1JobEnvelopeCoordinates {
  readonly plaintext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly senderKeyAgreementPrivateKey: Uint8Array;
  readonly recipientKeyAgreementPublicKey: Uint8Array;
  readonly signingPrivateKey: Uint8Array;
}

export interface OpenAncV1JobEnvelopeInput {
  readonly encoded: Uint8Array;
  readonly expectedVaultId: Uint8Array;
  readonly expectedJobId: Uint8Array;
  readonly expectedRecipientEndpointId: Uint8Array;
  readonly recipientKeyAgreementPrivateKey: Uint8Array;
  readonly nowSeconds: number;
  readonly resolveGrantSenderKeys: (grantRef: Uint8Array) =>
    | Promise<{
        signingPublicKey: Uint8Array;
        keyAgreementPublicKey: Uint8Array;
      } | null>
    | {
        signingPublicKey: Uint8Array;
        keyAgreementPublicKey: Uint8Array;
      }
    | null;
}

export interface SealAncV1ResultEnvelopeInput {
  readonly vaultId: Uint8Array;
  readonly envelopeId: Uint8Array;
  readonly createdAt: number;
  readonly jobId: Uint8Array;
  readonly jobHash: Uint8Array;
  readonly recipientEndpointId: Uint8Array;
  readonly state: "completed" | "failed";
  readonly plaintext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly senderKeyAgreementPrivateKey: Uint8Array;
  readonly recipientKeyAgreementPublicKey: Uint8Array;
  readonly signingPrivateKey: Uint8Array;
}

export interface OpenAncV1ResultEnvelopeInput {
  readonly encoded: Uint8Array;
  readonly expectedVaultId: Uint8Array;
  readonly expectedJobId: Uint8Array;
  readonly expectedJobHash: Uint8Array;
  readonly expectedRecipientEndpointId: Uint8Array;
  readonly recipientKeyAgreementPrivateKey: Uint8Array;
  readonly brokerSigningPublicKey: Uint8Array;
  readonly brokerKeyAgreementPublicKey: Uint8Array;
}

function fail(): never {
  throw new AncV1JobEnvelopeError();
}

function exactBytes(value: unknown, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail();
  return value.slice();
}

function boundedBytes(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    (!allowEmpty && value.byteLength === 0) ||
    value.byteLength > maximum
  ) {
    fail();
  }
  return value.slice();
}

function positive(value: unknown): number {
  const parsed = SAFE_POSITIVE.safeParse(value);
  if (!parsed.success) fail();
  return parsed.data;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function common(
  type: "job" | "result",
  input: {
    vaultId: Uint8Array;
    envelopeId: Uint8Array;
    createdAt: number;
  },
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, E2EE_SUITE_ID],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, exactBytes(input.vaultId, ID_BYTES)],
    [E2EE_ENVELOPE_FIELDS.common.type, type],
    [E2EE_ENVELOPE_FIELDS.common.createdAt, positive(input.createdAt)],
    [
      E2EE_ENVELOPE_FIELDS.common.envelopeId,
      exactBytes(input.envelopeId, ID_BYTES),
    ],
  ]);
}

async function seal(
  tag: "job" | "result",
  aad: Map<number, AncV1CanonicalValue>,
  ciphertextField: number,
  signatureField: number,
  input: {
    plaintext: Uint8Array;
    nonce: Uint8Array;
    senderKeyAgreementPrivateKey: Uint8Array;
    recipientKeyAgreementPublicKey: Uint8Array;
    signingPrivateKey: Uint8Array;
  },
  payloadLimit: number,
  envelopeLimit: number,
): Promise<Uint8Array> {
  const plaintext = boundedBytes(input.plaintext, payloadLimit, true);
  const nonce = exactBytes(input.nonce, NONCE_BYTES);
  let ciphertext: Uint8Array | null = null;
  try {
    ciphertext = await ancV1BoxEncrypt(
      tag,
      plaintext,
      nonce,
      input.recipientKeyAgreementPublicKey,
      input.senderKeyAgreementPrivateKey,
    );
    const unsigned = new Map(aad);
    unsigned.set(ciphertextField, ancV1PackNonceCiphertext(nonce, ciphertext));
    const signature = await ancV1SignDetached(
      tag,
      encodeAncV1Canonical(unsigned),
      input.signingPrivateKey,
    );
    const signed = new Map(unsigned);
    signed.set(signatureField, signature);
    const encoded = encodeAncV1Canonical(signed);
    if (encoded.byteLength > envelopeLimit) fail();
    return encoded;
  } catch {
    return fail();
  } finally {
    plaintext.fill(0);
    nonce.fill(0);
    ciphertext?.fill(0);
  }
}

export async function sealAncV1JobEnvelope(
  input: SealAncV1JobEnvelopeInput,
): Promise<Uint8Array> {
  const issuedAt = positive(input.issuedAt);
  const expiresAt = positive(input.expiresAt);
  if (expiresAt <= issuedAt || input.createdAt > issuedAt) fail();
  const aad = common("job", input);
  aad.set(E2EE_ENVELOPE_FIELDS.job.jobId, exactBytes(input.jobId, ID_BYTES));
  aad.set(
    E2EE_ENVELOPE_FIELDS.job.grantRef,
    exactBytes(input.grantRef, HASH_BYTES),
  );
  aad.set(E2EE_ENVELOPE_FIELDS.job.issuedAt, issuedAt);
  aad.set(E2EE_ENVELOPE_FIELDS.job.expiresAt, expiresAt);
  aad.set(
    E2EE_ENVELOPE_FIELDS.job.recipientEndpointId,
    exactBytes(input.recipientEndpointId, ID_BYTES),
  );
  return seal(
    "job",
    aad,
    E2EE_ENVELOPE_FIELDS.job.ciphertext,
    E2EE_ENVELOPE_FIELDS.job.signature,
    input,
    E2EE_SIZE_LIMITS.jobPayloadBytes,
    E2EE_SIZE_LIMITS.jobEnvelopeBytes,
  );
}

export async function openAncV1JobEnvelope(
  input: OpenAncV1JobEnvelopeInput,
): Promise<{
  readonly plaintext: Uint8Array;
  readonly grantRef: Uint8Array;
  readonly jobHash: Uint8Array;
}> {
  let plaintext: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  try {
    const envelope = decodeAncV1Envelope(input.encoded, jobKeys, {
      maxBytes: E2EE_SIZE_LIMITS.jobEnvelopeBytes,
    });
    if (envelope.size !== jobKeys.length) fail();
    if (envelope.get(1) !== E2EE_SUITE_ID || envelope.get(3) !== "job") {
      fail();
    }
    const vaultId = exactBytes(envelope.get(2), ID_BYTES);
    const jobId = exactBytes(envelope.get(90), ID_BYTES);
    const recipient = exactBytes(envelope.get(94), ID_BYTES);
    if (
      !sameBytes(vaultId, exactBytes(input.expectedVaultId, ID_BYTES)) ||
      !sameBytes(jobId, exactBytes(input.expectedJobId, ID_BYTES)) ||
      !sameBytes(
        recipient,
        exactBytes(input.expectedRecipientEndpointId, ID_BYTES),
      )
    ) {
      fail();
    }
    positive(envelope.get(4));
    exactBytes(envelope.get(5), ID_BYTES);
    const issuedAt = positive(envelope.get(92));
    const expiresAt = positive(envelope.get(93));
    const now = positive(input.nowSeconds);
    if (expiresAt <= issuedAt || now < issuedAt || now > expiresAt) fail();
    const grantRef = exactBytes(envelope.get(91), HASH_BYTES);
    const signature = exactBytes(envelope.get(96), SIGNATURE_BYTES);
    const unsigned = new Map(envelope);
    unsigned.delete(E2EE_ENVELOPE_FIELDS.job.signature);
    const unsignedBytes = encodeAncV1Canonical(unsigned);
    const senderKeys = await input.resolveGrantSenderKeys(grantRef.slice());
    if (
      senderKeys === null ||
      !(await ancV1VerifyDetached(
        "job",
        unsignedBytes,
        signature,
        senderKeys.signingPublicKey,
      ))
    ) {
      fail();
    }
    const packed = boundedBytes(
      envelope.get(95),
      E2EE_SIZE_LIMITS.jobPayloadBytes + NONCE_BYTES + 16,
    );
    ({ nonce, ciphertext } = ancV1UnpackNonceCiphertext(packed, NONCE_BYTES));
    plaintext = await ancV1BoxDecrypt(
      "job",
      ciphertext,
      nonce,
      senderKeys.keyAgreementPublicKey,
      input.recipientKeyAgreementPrivateKey,
    );
    if (plaintext.byteLength > E2EE_SIZE_LIMITS.jobPayloadBytes) {
      fail();
    }
    const jobHash = await ancV1Hash("job", input.encoded);
    const output = plaintext;
    plaintext = null;
    return { plaintext: output, grantRef, jobHash };
  } catch {
    return fail();
  } finally {
    plaintext?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
  }
}

export async function sealAncV1ResultEnvelope(
  input: SealAncV1ResultEnvelopeInput,
): Promise<Uint8Array> {
  const aad = common("result", input);
  aad.set(E2EE_ENVELOPE_FIELDS.result.jobId, exactBytes(input.jobId, ID_BYTES));
  aad.set(
    E2EE_ENVELOPE_FIELDS.result.jobHash,
    exactBytes(input.jobHash, HASH_BYTES),
  );
  aad.set(
    E2EE_ENVELOPE_FIELDS.result.recipientEndpointId,
    exactBytes(input.recipientEndpointId, ID_BYTES),
  );
  aad.set(E2EE_ENVELOPE_FIELDS.result.state, input.state);
  return seal(
    "result",
    aad,
    E2EE_ENVELOPE_FIELDS.result.ciphertext,
    E2EE_ENVELOPE_FIELDS.result.signature,
    input,
    E2EE_SIZE_LIMITS.resultPayloadBytes,
    E2EE_SIZE_LIMITS.resultEnvelopeBytes,
  );
}

export async function openAncV1ResultEnvelope(
  input: OpenAncV1ResultEnvelopeInput,
): Promise<{
  readonly plaintext: Uint8Array;
  readonly state: "completed" | "failed";
}> {
  let plaintext: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  try {
    const envelope = decodeAncV1Envelope(input.encoded, resultKeys, {
      maxBytes: E2EE_SIZE_LIMITS.resultEnvelopeBytes,
    });
    if (
      envelope.size !== resultKeys.length ||
      envelope.get(E2EE_ENVELOPE_FIELDS.common.suite) !== E2EE_SUITE_ID ||
      envelope.get(E2EE_ENVELOPE_FIELDS.common.type) !== "result"
    ) {
      fail();
    }
    positive(envelope.get(E2EE_ENVELOPE_FIELDS.common.createdAt));
    exactBytes(envelope.get(E2EE_ENVELOPE_FIELDS.common.envelopeId), ID_BYTES);
    const vaultId = exactBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.common.vaultId),
      ID_BYTES,
    );
    const jobId = exactBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.result.jobId),
      ID_BYTES,
    );
    const jobHash = exactBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.result.jobHash),
      HASH_BYTES,
    );
    const recipient = exactBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.result.recipientEndpointId),
      ID_BYTES,
    );
    if (
      !sameBytes(vaultId, exactBytes(input.expectedVaultId, ID_BYTES)) ||
      !sameBytes(jobId, exactBytes(input.expectedJobId, ID_BYTES)) ||
      !sameBytes(jobHash, exactBytes(input.expectedJobHash, HASH_BYTES)) ||
      !sameBytes(
        recipient,
        exactBytes(input.expectedRecipientEndpointId, ID_BYTES),
      )
    ) {
      fail();
    }
    const state = envelope.get(E2EE_ENVELOPE_FIELDS.result.state);
    if (state !== "completed" && state !== "failed") fail();
    const signature = exactBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.result.signature),
      SIGNATURE_BYTES,
    );
    const unsigned = new Map(envelope);
    unsigned.delete(E2EE_ENVELOPE_FIELDS.result.signature);
    const unsignedBytes = encodeAncV1Canonical(unsigned);
    if (
      !(await ancV1VerifyDetached(
        "result",
        unsignedBytes,
        signature,
        input.brokerSigningPublicKey,
      ))
    ) {
      fail();
    }
    const packed = boundedBytes(
      envelope.get(E2EE_ENVELOPE_FIELDS.result.ciphertext),
      E2EE_SIZE_LIMITS.resultPayloadBytes + NONCE_BYTES + 16,
    );
    ({ nonce, ciphertext } = ancV1UnpackNonceCiphertext(packed, NONCE_BYTES));
    plaintext = await ancV1BoxDecrypt(
      "result",
      ciphertext,
      nonce,
      input.brokerKeyAgreementPublicKey,
      input.recipientKeyAgreementPrivateKey,
    );
    if (plaintext.byteLength > E2EE_SIZE_LIMITS.resultPayloadBytes) fail();
    const output = plaintext;
    plaintext = null;
    return { plaintext: output, state };
  } catch {
    return fail();
  } finally {
    plaintext?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
  }
}

export function parseAncV1ResultEnvelopeCoordinates(encoded: Uint8Array): {
  readonly vaultId: Uint8Array;
  readonly jobId: Uint8Array;
  readonly jobHash: Uint8Array;
  readonly recipientEndpointId: Uint8Array;
  readonly state: "completed" | "failed";
} {
  try {
    const envelope = decodeAncV1Envelope(encoded, resultKeys, {
      maxBytes: E2EE_SIZE_LIMITS.resultEnvelopeBytes,
    });
    if (
      envelope.size !== resultKeys.length ||
      envelope.get(1) !== E2EE_SUITE_ID ||
      envelope.get(3) !== "result"
    ) {
      fail();
    }
    positive(envelope.get(4));
    exactBytes(envelope.get(5), ID_BYTES);
    boundedBytes(
      envelope.get(103),
      E2EE_SIZE_LIMITS.resultPayloadBytes + NONCE_BYTES + 16,
    );
    exactBytes(envelope.get(104), SIGNATURE_BYTES);
    const state = envelope.get(105);
    if (state !== "completed" && state !== "failed") fail();
    return {
      vaultId: exactBytes(envelope.get(2), ID_BYTES),
      jobId: exactBytes(envelope.get(100), ID_BYTES),
      jobHash: exactBytes(envelope.get(101), HASH_BYTES),
      recipientEndpointId: exactBytes(envelope.get(102), ID_BYTES),
      state,
    };
  } catch {
    throw new AncV1JobEnvelopeError();
  }
}

export function ancV1JobHashHex(hash: Uint8Array): string {
  return ancV1BytesToHex(exactBytes(hash, HASH_BYTES));
}
