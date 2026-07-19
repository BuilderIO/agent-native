import {
  type AncV1CanonicalValue,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ancV1AeadDecrypt,
  ancV1AeadEncrypt,
  ancV1DeriveKey,
  ancV1Hash,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const EXPORT = E2EE_ENVELOPE_FIELDS.exportArchive;
const TYPE = "export-archive";
export const ANC_V1_EXPORT_ARCHIVE_MAX_ENCODED_BYTES =
  E2EE_SIZE_LIMITS.exportPlaintextBytes + 64 * 1024;

export class AncV1ExportArchiveError extends Error {
  constructor() {
    super("Private Vault export archive verification failed");
    this.name = "AncV1ExportArchiveError";
  }
}

export interface AncV1ExportArchiveMetadata {
  readonly vaultId: Uint8Array;
  readonly exportId: Uint8Array;
  readonly createdAt: number;
  readonly sourceSnapshotHash: Uint8Array;
  readonly objectCount: number;
  readonly plaintextHash: Uint8Array;
}

export interface AncV1SealExportArchiveInput {
  readonly vaultId: Uint8Array;
  readonly exportId: Uint8Array;
  readonly createdAt: number;
  readonly sourceSnapshotHash: Uint8Array;
  readonly objectCount: number;
  readonly plaintext: Uint8Array;
  readonly recoveryRoot: Uint8Array;
  readonly nonce: Uint8Array;
}

export interface AncV1OpenExportArchiveInput {
  readonly encoded: Uint8Array;
  readonly expectedVaultId: Uint8Array;
  readonly recoveryRoot: Uint8Array;
}

export interface AncV1OpenedExportArchive extends AncV1ExportArchiveMetadata {
  readonly plaintext: Uint8Array;
}

const fail = (): never => {
  throw new AncV1ExportArchiveError();
};

function snapshot(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail();
  return value.slice();
}

function boundedPlaintext(value: Uint8Array): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes
  )
    fail();
  return value.slice();
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail();
}

function bytes(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  length?: number,
): Uint8Array {
  const value = map.get(key);
  if (
    !(value instanceof Uint8Array) ||
    (length !== undefined && value.byteLength !== length)
  )
    throw new AncV1ExportArchiveError();
  return value.slice();
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    different |= left[index]! ^ right[index]!;
  return different === 0;
}

function headerMap(metadata: AncV1ExportArchiveMetadata, nonce: Uint8Array) {
  return new Map<number, AncV1CanonicalValue>([
    [COMMON.suite, E2EE_SUITE_ID],
    [COMMON.vaultId, metadata.vaultId],
    [COMMON.type, TYPE],
    [COMMON.createdAt, metadata.createdAt],
    [COMMON.envelopeId, metadata.exportId],
    [EXPORT.sourceSnapshotHash, metadata.sourceSnapshotHash],
    [EXPORT.objectCount, metadata.objectCount],
    [EXPORT.plaintextHash, metadata.plaintextHash],
    [EXPORT.nonce, nonce],
  ]);
}

function decode(encoded: Uint8Array) {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength > ANC_V1_EXPORT_ARCHIVE_MAX_ENCODED_BYTES
  )
    fail();
  let map: ReadonlyMap<number, AncV1CanonicalValue>;
  try {
    map = decodeAncV1Envelope(
      encoded,
      [...Object.values(COMMON), ...Object.values(EXPORT)],
      { maxBytes: ANC_V1_EXPORT_ARCHIVE_MAX_ENCODED_BYTES },
    );
  } catch {
    return fail();
  }
  if (
    map.size !== 10 ||
    map.get(COMMON.suite) !== E2EE_SUITE_ID ||
    map.get(COMMON.type) !== TYPE
  )
    fail();
  const metadata: AncV1ExportArchiveMetadata = {
    vaultId: bytes(map, COMMON.vaultId, 16),
    exportId: bytes(map, COMMON.envelopeId, 16),
    createdAt: positiveInteger(map.get(COMMON.createdAt)),
    sourceSnapshotHash: bytes(map, EXPORT.sourceSnapshotHash, 32),
    objectCount: positiveInteger(map.get(EXPORT.objectCount)),
    plaintextHash: bytes(map, EXPORT.plaintextHash, 32),
  };
  const nonce = bytes(map, EXPORT.nonce, 24);
  const ciphertext = bytes(map, EXPORT.ciphertext);
  if (
    ciphertext.byteLength <= 16 ||
    ciphertext.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes + 16
  )
    fail();
  return { metadata, nonce, ciphertext };
}

export async function sealAncV1ExportArchive(
  input: AncV1SealExportArchiveInput,
): Promise<Uint8Array> {
  const vaultId = snapshot(input.vaultId, 16);
  const exportId = snapshot(input.exportId, 16);
  const sourceSnapshotHash = snapshot(input.sourceSnapshotHash, 32);
  const recoveryRoot = snapshot(input.recoveryRoot, 32);
  const nonce = snapshot(input.nonce, 24);
  const plaintext = boundedPlaintext(input.plaintext);
  const createdAt = positiveInteger(input.createdAt);
  const objectCount = positiveInteger(input.objectCount);
  let exportKey: Uint8Array | undefined;
  try {
    const metadata: AncV1ExportArchiveMetadata = {
      vaultId,
      exportId,
      createdAt,
      sourceSnapshotHash,
      objectCount,
      plaintextHash: await ancV1Hash("export-archive", plaintext),
    };
    const header = headerMap(metadata, nonce);
    exportKey = await ancV1DeriveKey("export-key", recoveryRoot);
    const ciphertext = await ancV1AeadEncrypt(
      "export-archive",
      plaintext,
      encodeAncV1Canonical(header),
      nonce,
      exportKey,
    );
    return encodeAncV1Canonical(
      new Map(header).set(EXPORT.ciphertext, ciphertext),
    );
  } catch (error) {
    if (error instanceof AncV1ExportArchiveError) throw error;
    return fail();
  } finally {
    recoveryRoot.fill(0);
    exportKey?.fill(0);
    plaintext.fill(0);
  }
}

/** Read only public archive coordinates needed to derive the recovery root. */
export function inspectAncV1ExportArchive(
  encoded: Uint8Array,
): AncV1ExportArchiveMetadata {
  const { metadata } = decode(encoded);
  return metadata;
}

export async function openAncV1ExportArchive(
  input: AncV1OpenExportArchiveInput,
): Promise<AncV1OpenedExportArchive> {
  const expectedVaultId = snapshot(input.expectedVaultId, 16);
  const recoveryRoot = snapshot(input.recoveryRoot, 32);
  let exportKey: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const parsed = decode(input.encoded);
    if (!equal(parsed.metadata.vaultId, expectedVaultId)) fail();
    exportKey = await ancV1DeriveKey("export-key", recoveryRoot);
    plaintext = await ancV1AeadDecrypt(
      "export-archive",
      parsed.ciphertext,
      encodeAncV1Canonical(headerMap(parsed.metadata, parsed.nonce)),
      parsed.nonce,
      exportKey,
    );
    if (
      plaintext.byteLength === 0 ||
      plaintext.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes ||
      !equal(
        await ancV1Hash("export-archive", plaintext),
        parsed.metadata.plaintextHash,
      )
    )
      fail();
    return { ...parsed.metadata, plaintext };
  } catch (error) {
    plaintext?.fill(0);
    if (error instanceof AncV1ExportArchiveError) throw error;
    return fail();
  } finally {
    expectedVaultId.fill(0);
    recoveryRoot.fill(0);
    exportKey?.fill(0);
  }
}
