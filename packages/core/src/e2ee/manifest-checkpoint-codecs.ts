import sodium from "libsodium-wrappers-sumo";

import {
  type AncV1CanonicalValue,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  decodeAncV1EnrollmentAuthorization,
  verifyAncV1EnrollmentAuthorizationSignature,
} from "./enrollment-ceremony-codecs.js";
import { ancV1Hash } from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS } from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
export const ANC_ENROLLMENT_MANIFEST_SUITE_ID =
  "anc/enrollment-manifest/v1" as const;
export const ANC_ENROLLMENT_MANIFEST_FIELDS = Object.freeze({
  checkpoint: Object.freeze({
    manifestObjectId: 10,
    revisionId: 11,
    generation: 12,
    ciphertextHash: 13,
    signerEndpointId: 14,
    signature: 15,
  }),
  authorization: Object.freeze({
    enrollmentAuthorizationHash: 20,
    manifestCheckpointHash: 21,
    authorizerEndpointId: 22,
    expiresAt: 23,
    signature: 24,
  }),
});
export const ANC_ENROLLMENT_MANIFEST_SIZE_LIMITS = Object.freeze({
  checkpointBytes: 1_024,
  authorizationBytes: 1_024,
});
const CHECKPOINT = ANC_ENROLLMENT_MANIFEST_FIELDS.checkpoint;
const BINDING = ANC_ENROLLMENT_MANIFEST_FIELDS.authorization;
const ID_BYTES = 16;
const REVISION_ID_BYTES = 32;
const HASH_BYTES = 32;
const SIGNATURE_BYTES = 64;

export class AncV1ManifestCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1ManifestCheckpointError";
  }
}

type CommonEnvelope = {
  suite: typeof ANC_ENROLLMENT_MANIFEST_SUITE_ID;
  vaultId: Uint8Array;
  type: string;
  createdAt: number;
  envelopeId: Uint8Array;
};

export interface AncV1UnsignedPrivateVaultManifestCheckpoint extends CommonEnvelope {
  type: "private-vault-manifest-checkpoint";
  manifestObjectId: Uint8Array;
  revisionId: Uint8Array;
  generation: number;
  ciphertextHash: Uint8Array;
  signerEndpointId: Uint8Array;
}

export interface AncV1PrivateVaultManifestCheckpoint extends AncV1UnsignedPrivateVaultManifestCheckpoint {
  signature: Uint8Array;
}

/**
 * Additive v1 extension. The frozen enrollment-authorization envelope remains
 * byte-for-byte unchanged; consumers that require a manifest checkpoint must
 * require this companion envelope and verify the complete bundle.
 */
export interface AncV1UnsignedEnrollmentManifestAuthorization extends CommonEnvelope {
  type: "enrollment-manifest-authorization";
  enrollmentAuthorizationHash: Uint8Array;
  manifestCheckpointHash: Uint8Array;
  authorizerEndpointId: Uint8Array;
  expiresAt: number;
}

export interface AncV1EnrollmentManifestAuthorization extends AncV1UnsignedEnrollmentManifestAuthorization {
  signature: Uint8Array;
}

const checkpointUnsignedFields = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "manifestObjectId",
  "revisionId",
  "generation",
  "ciphertextHash",
  "signerEndpointId",
] as const;
const checkpointFields = [...checkpointUnsignedFields, "signature"] as const;
const bindingUnsignedFields = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "enrollmentAuthorizationHash",
  "manifestCheckpointHash",
  "authorizerEndpointId",
  "expiresAt",
] as const;
const bindingFields = [...bindingUnsignedFields, "signature"] as const;
const commonKeys = Object.values(COMMON);
const checkpointKeys = [...commonKeys, ...Object.values(CHECKPOINT)];
const bindingKeys = [...commonKeys, ...Object.values(BINDING)];

function fail(message: string): never {
  throw new AncV1ManifestCheckpointError(message);
}

function exact(value: object, fields: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(`${name} must contain exactly its versioned fields`);
  }
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length)
    fail(`${name} must be exactly ${length} bytes`);
  return value.slice();
}

function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    fail(`${name} must be a positive safe integer`);
  return value as number;
}

function text<T extends string>(value: unknown, expected: T, name: string): T {
  if (value !== expected) fail(`${name} must be ${expected}`);
  return expected;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function extensionPreimage(
  domain:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
  preimage: Uint8Array,
): Uint8Array {
  const prefix = new TextEncoder().encode(
    `${ANC_ENROLLMENT_MANIFEST_SUITE_ID}/${domain}\0`,
  );
  const result = new Uint8Array(prefix.byteLength + preimage.byteLength);
  result.set(prefix);
  result.set(preimage, prefix.byteLength);
  return result;
}

async function extensionHash(
  domain:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
  preimage: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(
    32,
    extensionPreimage(domain, preimage),
    null,
  );
}

async function extensionSign(
  domain:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
  preimage: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_sign_detached(
    extensionPreimage(domain, preimage),
    bytes(privateKey, 64, "signingPrivateKey"),
  );
}

async function extensionVerify(
  domain:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
  preimage: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  await sodium.ready;
  return sodium.crypto_sign_verify_detached(
    bytes(signature, SIGNATURE_BYTES, "signature"),
    extensionPreimage(domain, preimage),
    bytes(publicKey, 32, "signingPublicKey"),
  );
}

function field(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  name: string,
): AncV1CanonicalValue {
  if (!map.has(key)) fail(`${name} is required`);
  return map.get(key)!;
}

function commonMap(
  value: CommonEnvelope,
  expectedType:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [
      COMMON.suite,
      text(value.suite, ANC_ENROLLMENT_MANIFEST_SUITE_ID, "suite"),
    ],
    [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
    [COMMON.type, text(value.type, expectedType, "type")],
    [COMMON.createdAt, integer(value.createdAt, "createdAt")],
    [COMMON.envelopeId, bytes(value.envelopeId, ID_BYTES, "envelopeId")],
  ]);
}

function decodeCommon(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  expectedType:
    | "private-vault-manifest-checkpoint"
    | "enrollment-manifest-authorization",
  expectedVaultId: Uint8Array,
): CommonEnvelope {
  const vaultId = bytes(
    field(map, COMMON.vaultId, "vaultId"),
    ID_BYTES,
    "vaultId",
  );
  if (!equalBytes(vaultId, bytes(expectedVaultId, ID_BYTES, "expectedVaultId")))
    fail("vaultId does not match the expected vault");
  return {
    suite: text(
      field(map, COMMON.suite, "suite"),
      ANC_ENROLLMENT_MANIFEST_SUITE_ID,
      "suite",
    ),
    vaultId,
    type: text(field(map, COMMON.type, "type"), expectedType, "type"),
    createdAt: integer(field(map, COMMON.createdAt, "createdAt"), "createdAt"),
    envelopeId: bytes(
      field(map, COMMON.envelopeId, "envelopeId"),
      ID_BYTES,
      "envelopeId",
    ),
  };
}

function unsignedCheckpointMap(
  value: AncV1UnsignedPrivateVaultManifestCheckpoint,
): Map<number, AncV1CanonicalValue> {
  exact(value, checkpointUnsignedFields, "Unsigned manifest checkpoint");
  return new Map([
    ...commonMap(value, "private-vault-manifest-checkpoint"),
    [
      CHECKPOINT.manifestObjectId,
      bytes(value.manifestObjectId, ID_BYTES, "manifestObjectId"),
    ],
    [
      CHECKPOINT.revisionId,
      bytes(value.revisionId, REVISION_ID_BYTES, "revisionId"),
    ],
    [CHECKPOINT.generation, integer(value.generation, "generation")],
    [
      CHECKPOINT.ciphertextHash,
      bytes(value.ciphertextHash, HASH_BYTES, "ciphertextHash"),
    ],
    [
      CHECKPOINT.signerEndpointId,
      bytes(value.signerEndpointId, ID_BYTES, "signerEndpointId"),
    ],
  ]);
}

export function encodeAncV1UnsignedPrivateVaultManifestCheckpoint(
  value: AncV1UnsignedPrivateVaultManifestCheckpoint,
): Uint8Array {
  return encodeAncV1Canonical(unsignedCheckpointMap(value));
}

export function encodeAncV1PrivateVaultManifestCheckpoint(
  value: AncV1PrivateVaultManifestCheckpoint,
): Uint8Array {
  exact(value, checkpointFields, "Manifest checkpoint");
  const { signature, ...unsigned } = value;
  const encoded = encodeAncV1Canonical(
    new Map([
      ...unsignedCheckpointMap(unsigned),
      [CHECKPOINT.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
  if (encoded.byteLength > ANC_ENROLLMENT_MANIFEST_SIZE_LIMITS.checkpointBytes)
    fail("Manifest checkpoint exceeds its size limit");
  return encoded;
}

export async function signAncV1PrivateVaultManifestCheckpoint(
  value: AncV1UnsignedPrivateVaultManifestCheckpoint,
  signerPrivateKey: Uint8Array,
): Promise<AncV1PrivateVaultManifestCheckpoint> {
  return {
    ...value,
    signature: await extensionSign(
      "private-vault-manifest-checkpoint",
      encodeAncV1UnsignedPrivateVaultManifestCheckpoint(value),
      signerPrivateKey,
    ),
  };
}

export function decodeAncV1PrivateVaultManifestCheckpoint(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1PrivateVaultManifestCheckpoint {
  exact(binding, ["expectedVaultId"], "Manifest checkpoint binding");
  let map: ReadonlyMap<number, AncV1CanonicalValue>;
  try {
    map = decodeAncV1Envelope(encoded, checkpointKeys, {
      maxBytes: ANC_ENROLLMENT_MANIFEST_SIZE_LIMITS.checkpointBytes,
    });
  } catch (error) {
    fail(
      error instanceof Error ? error.message : "Invalid manifest checkpoint",
    );
  }
  return {
    ...decodeCommon(
      map!,
      "private-vault-manifest-checkpoint",
      binding.expectedVaultId,
    ),
    type: "private-vault-manifest-checkpoint",
    manifestObjectId: bytes(
      field(map!, CHECKPOINT.manifestObjectId, "manifestObjectId"),
      ID_BYTES,
      "manifestObjectId",
    ),
    revisionId: bytes(
      field(map!, CHECKPOINT.revisionId, "revisionId"),
      REVISION_ID_BYTES,
      "revisionId",
    ),
    generation: integer(
      field(map!, CHECKPOINT.generation, "generation"),
      "generation",
    ),
    ciphertextHash: bytes(
      field(map!, CHECKPOINT.ciphertextHash, "ciphertextHash"),
      HASH_BYTES,
      "ciphertextHash",
    ),
    signerEndpointId: bytes(
      field(map!, CHECKPOINT.signerEndpointId, "signerEndpointId"),
      ID_BYTES,
      "signerEndpointId",
    ),
    signature: bytes(
      field(map!, CHECKPOINT.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
}

export async function hashAncV1PrivateVaultManifestCheckpoint(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): Promise<Uint8Array> {
  decodeAncV1PrivateVaultManifestCheckpoint(encoded, { expectedVaultId });
  return extensionHash("private-vault-manifest-checkpoint", encoded.slice());
}

export async function verifyAncV1PrivateVaultManifestCheckpoint(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array; signerSigningPublicKey: Uint8Array },
): Promise<AncV1PrivateVaultManifestCheckpoint> {
  exact(
    binding,
    ["expectedVaultId", "signerSigningPublicKey"],
    "Manifest checkpoint verification binding",
  );
  const checkpoint = decodeAncV1PrivateVaultManifestCheckpoint(encoded, {
    expectedVaultId: binding.expectedVaultId,
  });
  const { signature, ...unsigned } = checkpoint;
  if (
    !(await extensionVerify(
      "private-vault-manifest-checkpoint",
      encodeAncV1UnsignedPrivateVaultManifestCheckpoint(unsigned),
      signature,
      bytes(binding.signerSigningPublicKey, 32, "signerSigningPublicKey"),
    ))
  )
    fail("Manifest checkpoint signature verification failed");
  return checkpoint;
}

function unsignedBindingMap(
  value: AncV1UnsignedEnrollmentManifestAuthorization,
): Map<number, AncV1CanonicalValue> {
  exact(
    value,
    bindingUnsignedFields,
    "Unsigned enrollment manifest authorization",
  );
  if (value.expiresAt < value.createdAt)
    fail("expiresAt must not precede createdAt");
  return new Map([
    ...commonMap(value, "enrollment-manifest-authorization"),
    [
      BINDING.enrollmentAuthorizationHash,
      bytes(
        value.enrollmentAuthorizationHash,
        HASH_BYTES,
        "enrollmentAuthorizationHash",
      ),
    ],
    [
      BINDING.manifestCheckpointHash,
      bytes(value.manifestCheckpointHash, HASH_BYTES, "manifestCheckpointHash"),
    ],
    [
      BINDING.authorizerEndpointId,
      bytes(value.authorizerEndpointId, ID_BYTES, "authorizerEndpointId"),
    ],
    [BINDING.expiresAt, integer(value.expiresAt, "expiresAt")],
  ]);
}

export function encodeAncV1UnsignedEnrollmentManifestAuthorization(
  value: AncV1UnsignedEnrollmentManifestAuthorization,
): Uint8Array {
  return encodeAncV1Canonical(unsignedBindingMap(value));
}

export function encodeAncV1EnrollmentManifestAuthorization(
  value: AncV1EnrollmentManifestAuthorization,
): Uint8Array {
  exact(value, bindingFields, "Enrollment manifest authorization");
  const { signature, ...unsigned } = value;
  const encoded = encodeAncV1Canonical(
    new Map([
      ...unsignedBindingMap(unsigned),
      [BINDING.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
  if (
    encoded.byteLength > ANC_ENROLLMENT_MANIFEST_SIZE_LIMITS.authorizationBytes
  )
    fail("Enrollment manifest authorization exceeds its size limit");
  return encoded;
}

export async function signAncV1EnrollmentManifestAuthorization(
  value: AncV1UnsignedEnrollmentManifestAuthorization,
  authorizerPrivateKey: Uint8Array,
): Promise<AncV1EnrollmentManifestAuthorization> {
  return {
    ...value,
    signature: await extensionSign(
      "enrollment-manifest-authorization",
      encodeAncV1UnsignedEnrollmentManifestAuthorization(value),
      authorizerPrivateKey,
    ),
  };
}

export function decodeAncV1EnrollmentManifestAuthorization(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1EnrollmentManifestAuthorization {
  exact(
    binding,
    ["expectedVaultId"],
    "Enrollment manifest authorization binding",
  );
  let map: ReadonlyMap<number, AncV1CanonicalValue>;
  try {
    map = decodeAncV1Envelope(encoded, bindingKeys, {
      maxBytes: ANC_ENROLLMENT_MANIFEST_SIZE_LIMITS.authorizationBytes,
    });
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : "Invalid enrollment manifest authorization",
    );
  }
  const common = decodeCommon(
    map!,
    "enrollment-manifest-authorization",
    binding.expectedVaultId,
  );
  const result: AncV1EnrollmentManifestAuthorization = {
    ...common,
    type: "enrollment-manifest-authorization",
    enrollmentAuthorizationHash: bytes(
      field(
        map!,
        BINDING.enrollmentAuthorizationHash,
        "enrollmentAuthorizationHash",
      ),
      HASH_BYTES,
      "enrollmentAuthorizationHash",
    ),
    manifestCheckpointHash: bytes(
      field(map!, BINDING.manifestCheckpointHash, "manifestCheckpointHash"),
      HASH_BYTES,
      "manifestCheckpointHash",
    ),
    authorizerEndpointId: bytes(
      field(map!, BINDING.authorizerEndpointId, "authorizerEndpointId"),
      ID_BYTES,
      "authorizerEndpointId",
    ),
    expiresAt: integer(
      field(map!, BINDING.expiresAt, "expiresAt"),
      "expiresAt",
    ),
    signature: bytes(
      field(map!, BINDING.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
  if (result.expiresAt < result.createdAt)
    fail("expiresAt must not precede createdAt");
  return result;
}

export async function verifyAncV1EnrollmentManifestAuthorizationBundle(input: {
  encodedEnrollmentAuthorization: Uint8Array;
  encodedManifestCheckpoint: Uint8Array;
  encodedManifestAuthorization: Uint8Array;
  expectedVaultId: Uint8Array;
  authorizerSigningPublicKey: Uint8Array;
  expectedManifestObjectId: Uint8Array;
  expectedRevisionId: Uint8Array;
  expectedGeneration: number;
  expectedCiphertextHash: Uint8Array;
  now: number;
}): Promise<{
  enrollmentAuthorization: ReturnType<
    typeof decodeAncV1EnrollmentAuthorization
  >;
  manifestCheckpoint: AncV1PrivateVaultManifestCheckpoint;
  manifestAuthorization: AncV1EnrollmentManifestAuthorization;
}> {
  exact(
    input,
    [
      "encodedEnrollmentAuthorization",
      "encodedManifestCheckpoint",
      "encodedManifestAuthorization",
      "expectedVaultId",
      "authorizerSigningPublicKey",
      "expectedManifestObjectId",
      "expectedRevisionId",
      "expectedGeneration",
      "expectedCiphertextHash",
      "now",
    ],
    "Enrollment manifest bundle verification input",
  );
  const now = integer(input.now, "now");
  const enrollmentAuthorization =
    await verifyAncV1EnrollmentAuthorizationSignature(
      input.encodedEnrollmentAuthorization,
      {
        expectedVaultId: input.expectedVaultId,
        expectedAuthorizerSigningPublicKey: input.authorizerSigningPublicKey,
      },
    );
  const manifestCheckpoint = await verifyAncV1PrivateVaultManifestCheckpoint(
    input.encodedManifestCheckpoint,
    {
      expectedVaultId: input.expectedVaultId,
      signerSigningPublicKey: input.authorizerSigningPublicKey,
    },
  );
  const manifestAuthorization = decodeAncV1EnrollmentManifestAuthorization(
    input.encodedManifestAuthorization,
    { expectedVaultId: input.expectedVaultId },
  );
  const { signature, ...unsignedBinding } = manifestAuthorization;
  if (
    !(await extensionVerify(
      "enrollment-manifest-authorization",
      encodeAncV1UnsignedEnrollmentManifestAuthorization(unsignedBinding),
      signature,
      bytes(input.authorizerSigningPublicKey, 32, "authorizerSigningPublicKey"),
    ))
  )
    fail("Enrollment manifest authorization signature verification failed");
  const expectedAuthorizationHash = await ancV1Hash(
    "enrollment-authorization",
    input.encodedEnrollmentAuthorization.slice(),
  );
  const expectedCheckpointHash = await hashAncV1PrivateVaultManifestCheckpoint(
    input.encodedManifestCheckpoint,
    input.expectedVaultId,
  );
  if (
    !equalBytes(
      manifestAuthorization.enrollmentAuthorizationHash,
      expectedAuthorizationHash,
    ) ||
    !equalBytes(
      manifestAuthorization.manifestCheckpointHash,
      expectedCheckpointHash,
    ) ||
    !equalBytes(
      manifestAuthorization.authorizerEndpointId,
      enrollmentAuthorization.authorizerEndpointId,
    ) ||
    !equalBytes(
      manifestCheckpoint.signerEndpointId,
      enrollmentAuthorization.authorizerEndpointId,
    ) ||
    !equalBytes(
      manifestCheckpoint.manifestObjectId,
      bytes(
        input.expectedManifestObjectId,
        ID_BYTES,
        "expectedManifestObjectId",
      ),
    ) ||
    !equalBytes(
      manifestCheckpoint.revisionId,
      bytes(input.expectedRevisionId, REVISION_ID_BYTES, "expectedRevisionId"),
    ) ||
    manifestCheckpoint.generation !==
      integer(input.expectedGeneration, "expectedGeneration") ||
    !equalBytes(
      manifestCheckpoint.ciphertextHash,
      bytes(input.expectedCiphertextHash, HASH_BYTES, "expectedCiphertextHash"),
    ) ||
    manifestAuthorization.createdAt < enrollmentAuthorization.createdAt ||
    manifestAuthorization.expiresAt > enrollmentAuthorization.expiresAt ||
    manifestCheckpoint.createdAt < enrollmentAuthorization.createdAt ||
    manifestCheckpoint.createdAt > manifestAuthorization.createdAt ||
    now < manifestAuthorization.createdAt ||
    now > manifestAuthorization.expiresAt
  )
    fail(
      "Manifest checkpoint is not bound to this live enrollment authorization",
    );
  return { enrollmentAuthorization, manifestCheckpoint, manifestAuthorization };
}
