import {
  type AncV1CanonicalValue,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ancV1AeadDecrypt,
  ancV1AeadEncrypt,
  ancV1Hash,
  ancV1SecretstreamDecryptOne,
  ancV1SecretstreamEncryptOne,
  ancV1SignDetached,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const BUNDLE_TYPE = "anc/v1-object-bundle";
const BUNDLE_FIELDS = Object.freeze({
  type: 1,
  dekWrap: 2,
  header: 3,
  chunks: 4,
});
const COMMON_KEYS = Object.values(E2EE_ENVELOPE_FIELDS.common);
const DEK_WRAP_KEYS = [
  ...COMMON_KEYS,
  ...Object.values(E2EE_ENVELOPE_FIELDS.dekWrap),
];
const HEADER_KEYS = [
  ...COMMON_KEYS,
  ...Object.values(E2EE_ENVELOPE_FIELDS.objectHeader),
];
const CHUNK_KEYS = [
  ...COMMON_KEYS,
  ...Object.values(E2EE_ENVELOPE_FIELDS.chunk),
];
const encoder = new TextEncoder();

export class AncV1ObjectEnvelopeError extends Error {
  constructor() {
    super("Private Vault object envelope verification failed");
    this.name = "AncV1ObjectEnvelopeError";
  }
}

export interface AncV1ObjectCoordinates {
  readonly vaultId: Uint8Array;
  readonly objectId: Uint8Array;
  readonly revision: number;
  readonly epoch: number;
  readonly writerEndpointId: Uint8Array;
}

export interface AncV1SealObjectRevisionInput extends AncV1ObjectCoordinates {
  readonly createdAt: number;
  readonly dekWrapEnvelopeId: Uint8Array;
  readonly objectHeaderEnvelopeId: Uint8Array;
  readonly chunkEnvelopeId: Uint8Array;
  readonly contentType: string;
  readonly plaintext: Uint8Array;
  readonly epochKey: Uint8Array;
  readonly dataKey: Uint8Array;
  readonly dekWrapNonce: Uint8Array;
  readonly writerSigningPrivateKey: Uint8Array;
}

export interface AncV1OpenObjectRevisionInput extends AncV1ObjectCoordinates {
  readonly encoded: Uint8Array;
  readonly epochKey: Uint8Array;
  readonly writerSigningPublicKey: Uint8Array;
}

export interface AncV1OpenedObjectRevision extends AncV1ObjectCoordinates {
  readonly createdAt: number;
  readonly contentType: string;
  readonly plaintext: Uint8Array;
}

function fail(): never {
  throw new AncV1ObjectEnvelopeError();
}

function snapshot(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail();
  return value.slice();
}

function snapshotBounded(value: Uint8Array, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  )
    fail();
  return value.slice();
}

function hasLength(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail();
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    different |= left[index]! ^ right[index]!;
  return different === 0;
}

function bytesField(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  length?: number,
): Uint8Array {
  const value = map.get(key);
  if (
    !(value instanceof Uint8Array) ||
    (length !== undefined && value.byteLength !== length)
  )
    fail();
  return value;
}

function integerField(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
): number {
  const value = map.get(key);
  return typeof value === "number" ? positiveInteger(value) : fail();
}

function textField(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
): string {
  const value = map.get(key);
  return typeof value === "string" && value.length > 0 ? value : fail();
}

function commonEnvelope(
  type: "dek-wrap" | "object-header" | "chunk",
  vaultId: Uint8Array,
  createdAt: number,
  envelopeId: Uint8Array,
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, E2EE_SUITE_ID],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, vaultId],
    [E2EE_ENVELOPE_FIELDS.common.type, type],
    [E2EE_ENVELOPE_FIELDS.common.createdAt, createdAt],
    [E2EE_ENVELOPE_FIELDS.common.envelopeId, envelopeId],
  ]);
}

function requireCommon(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  type: "dek-wrap" | "object-header" | "chunk",
  vaultId: Uint8Array,
): number {
  if (
    textField(map, E2EE_ENVELOPE_FIELDS.common.suite) !== E2EE_SUITE_ID ||
    textField(map, E2EE_ENVELOPE_FIELDS.common.type) !== type ||
    !bytesEqual(
      bytesField(map, E2EE_ENVELOPE_FIELDS.common.vaultId, 16),
      vaultId,
    )
  )
    fail();
  bytesField(map, E2EE_ENVELOPE_FIELDS.common.envelopeId, 16);
  return integerField(map, E2EE_ENVELOPE_FIELDS.common.createdAt);
}

function chunkAad(objectId: Uint8Array, revision: number): Uint8Array {
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [E2EE_ENVELOPE_FIELDS.objectHeader.objectId, objectId],
      [E2EE_ENVELOPE_FIELDS.objectHeader.revision, revision],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkIndex, 0],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkCount, 1],
    ]),
  );
}

function requireCoordinates(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  objectIdKey: number,
  revisionKey: number,
  objectId: Uint8Array,
  revision: number,
): void {
  if (
    !bytesEqual(bytesField(map, objectIdKey, 16), objectId) ||
    integerField(map, revisionKey) !== revision
  )
    fail();
}

export async function sealAncV1ObjectRevision(
  input: AncV1SealObjectRevisionInput,
): Promise<Uint8Array> {
  if (
    !hasLength(input.vaultId, 16) ||
    !hasLength(input.objectId, 16) ||
    !hasLength(input.writerEndpointId, 16) ||
    !hasLength(input.dekWrapEnvelopeId, 16) ||
    !hasLength(input.objectHeaderEnvelopeId, 16) ||
    !hasLength(input.chunkEnvelopeId, 16) ||
    !hasLength(input.epochKey, 32) ||
    !hasLength(input.dataKey, 32) ||
    !hasLength(input.dekWrapNonce, 24) ||
    !hasLength(input.writerSigningPrivateKey, 64) ||
    !(input.plaintext instanceof Uint8Array) ||
    input.plaintext.byteLength === 0 ||
    input.plaintext.byteLength > E2EE_SIZE_LIMITS.chunkPlaintextBytes ||
    !Number.isSafeInteger(input.revision) ||
    input.revision <= 0 ||
    !Number.isSafeInteger(input.epoch) ||
    input.epoch <= 0 ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt <= 0 ||
    typeof input.contentType !== "string" ||
    input.contentType.length === 0 ||
    input.contentType.length > 120 ||
    encoder.encode(input.contentType).byteLength > 120
  ) {
    fail();
  }
  const vaultId = snapshot(input.vaultId, 16);
  const objectId = snapshot(input.objectId, 16);
  const writerEndpointId = snapshot(input.writerEndpointId, 16);
  const wrapEnvelopeId = snapshot(input.dekWrapEnvelopeId, 16);
  const headerEnvelopeId = snapshot(input.objectHeaderEnvelopeId, 16);
  const chunkEnvelopeId = snapshot(input.chunkEnvelopeId, 16);
  const epochKey = snapshot(input.epochKey, 32);
  const dataKey = snapshot(input.dataKey, 32);
  const wrapNonce = snapshot(input.dekWrapNonce, 24);
  const signingKey = snapshot(input.writerSigningPrivateKey, 64);
  const plaintext = snapshotBounded(
    input.plaintext,
    E2EE_SIZE_LIMITS.chunkPlaintextBytes,
  );
  const revision = positiveInteger(input.revision);
  const epoch = positiveInteger(input.epoch);
  const createdAt = positiveInteger(input.createdAt);
  try {
    const wrapAad = commonEnvelope(
      "dek-wrap",
      vaultId,
      createdAt,
      wrapEnvelopeId,
    );
    wrapAad.set(E2EE_ENVELOPE_FIELDS.dekWrap.objectId, objectId);
    wrapAad.set(E2EE_ENVELOPE_FIELDS.dekWrap.revision, revision);
    wrapAad.set(E2EE_ENVELOPE_FIELDS.dekWrap.epoch, epoch);
    wrapAad.set(E2EE_ENVELOPE_FIELDS.dekWrap.nonce, wrapNonce);
    const dekWrap = encodeAncV1Canonical(
      new Map(wrapAad).set(
        E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext,
        await ancV1AeadEncrypt(
          "dek-wrap",
          dataKey,
          encodeAncV1Canonical(wrapAad),
          wrapNonce,
          epochKey,
        ),
      ),
    );

    const headerUnsigned = commonEnvelope(
      "object-header",
      vaultId,
      createdAt,
      headerEnvelopeId,
    );
    headerUnsigned.set(E2EE_ENVELOPE_FIELDS.objectHeader.objectId, objectId);
    headerUnsigned.set(E2EE_ENVELOPE_FIELDS.objectHeader.revision, revision);
    headerUnsigned.set(E2EE_ENVELOPE_FIELDS.objectHeader.epoch, epoch);
    headerUnsigned.set(E2EE_ENVELOPE_FIELDS.objectHeader.chunkCount, 1);
    headerUnsigned.set(
      E2EE_ENVELOPE_FIELDS.objectHeader.plaintextLength,
      plaintext.byteLength,
    );
    headerUnsigned.set(
      E2EE_ENVELOPE_FIELDS.objectHeader.contentType,
      input.contentType,
    );
    headerUnsigned.set(
      E2EE_ENVELOPE_FIELDS.objectHeader.dekWrapRef,
      await ancV1Hash("dek-wrap", dekWrap),
    );
    headerUnsigned.set(
      E2EE_ENVELOPE_FIELDS.objectHeader.writerEndpointId,
      writerEndpointId,
    );
    const header = encodeAncV1Canonical(
      new Map(headerUnsigned).set(
        E2EE_ENVELOPE_FIELDS.objectHeader.signature,
        await ancV1SignDetached(
          "object-header",
          encodeAncV1Canonical(headerUnsigned),
          signingKey,
        ),
      ),
    );

    const encrypted = await ancV1SecretstreamEncryptOne(
      "chunk",
      plaintext,
      chunkAad(objectId, revision),
      dataKey,
    );
    const chunk = commonEnvelope("chunk", vaultId, createdAt, chunkEnvelopeId);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.objectId, objectId);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.revision, revision);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.chunkIndex, 0);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.chunkCount, 1);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.secretstreamHeader, encrypted.header);
    chunk.set(E2EE_ENVELOPE_FIELDS.chunk.ciphertext, encrypted.ciphertext);

    return encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [BUNDLE_FIELDS.type, BUNDLE_TYPE],
        [BUNDLE_FIELDS.dekWrap, dekWrap],
        [BUNDLE_FIELDS.header, header],
        [BUNDLE_FIELDS.chunks, [encodeAncV1Canonical(chunk)]],
      ]),
    );
  } catch (error) {
    if (error instanceof AncV1ObjectEnvelopeError) throw error;
    return fail();
  } finally {
    epochKey.fill(0);
    dataKey.fill(0);
    signingKey.fill(0);
    plaintext.fill(0);
  }
}

export async function openAncV1ObjectRevision(
  input: AncV1OpenObjectRevisionInput,
): Promise<AncV1OpenedObjectRevision> {
  if (
    !hasLength(input.vaultId, 16) ||
    !hasLength(input.objectId, 16) ||
    !hasLength(input.writerEndpointId, 16) ||
    !hasLength(input.epochKey, 32) ||
    !hasLength(input.writerSigningPublicKey, 32) ||
    !(input.encoded instanceof Uint8Array) ||
    input.encoded.byteLength === 0 ||
    input.encoded.byteLength >
      E2EE_SIZE_LIMITS.chunkPlaintextBytes + 64 * 1024 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision <= 0 ||
    !Number.isSafeInteger(input.epoch) ||
    input.epoch <= 0
  ) {
    fail();
  }
  const vaultId = snapshot(input.vaultId, 16);
  const objectId = snapshot(input.objectId, 16);
  const writerEndpointId = snapshot(input.writerEndpointId, 16);
  const epochKey = snapshot(input.epochKey, 32);
  const writerPublicKey = snapshot(input.writerSigningPublicKey, 32);
  const encoded = snapshotBounded(
    input.encoded,
    E2EE_SIZE_LIMITS.chunkPlaintextBytes + 64 * 1024,
  );
  const revision = positiveInteger(input.revision);
  const epoch = positiveInteger(input.epoch);
  let dataKey: Uint8Array | undefined;
  try {
    const bundle = decodeAncV1Envelope(encoded, Object.values(BUNDLE_FIELDS), {
      maxBytes: E2EE_SIZE_LIMITS.chunkPlaintextBytes + 64 * 1024,
    });
    if (textField(bundle, BUNDLE_FIELDS.type) !== BUNDLE_TYPE) fail();
    const dekWrapBytes = bytesField(bundle, BUNDLE_FIELDS.dekWrap);
    const headerBytes = bytesField(bundle, BUNDLE_FIELDS.header);
    const chunks = bundle.get(BUNDLE_FIELDS.chunks);
    if (
      !Array.isArray(chunks) ||
      chunks.length !== 1 ||
      !(chunks[0] instanceof Uint8Array)
    )
      fail();
    const chunkBytes = chunks[0];
    const wrap = decodeAncV1Envelope(dekWrapBytes, DEK_WRAP_KEYS, {
      maxBytes: E2EE_SIZE_LIMITS.objectHeaderBytes,
    });
    const header = decodeAncV1Envelope(headerBytes, HEADER_KEYS, {
      maxBytes: E2EE_SIZE_LIMITS.objectHeaderBytes,
    });
    const chunk = decodeAncV1Envelope(chunkBytes, CHUNK_KEYS, {
      maxBytes: E2EE_SIZE_LIMITS.chunkPlaintextBytes + 64 * 1024,
    });
    const createdAt = requireCommon(wrap, "dek-wrap", vaultId);
    if (
      requireCommon(header, "object-header", vaultId) !== createdAt ||
      requireCommon(chunk, "chunk", vaultId) !== createdAt
    )
      fail();
    requireCoordinates(
      wrap,
      E2EE_ENVELOPE_FIELDS.dekWrap.objectId,
      E2EE_ENVELOPE_FIELDS.dekWrap.revision,
      objectId,
      revision,
    );
    requireCoordinates(
      header,
      E2EE_ENVELOPE_FIELDS.objectHeader.objectId,
      E2EE_ENVELOPE_FIELDS.objectHeader.revision,
      objectId,
      revision,
    );
    requireCoordinates(
      chunk,
      E2EE_ENVELOPE_FIELDS.chunk.objectId,
      E2EE_ENVELOPE_FIELDS.chunk.revision,
      objectId,
      revision,
    );
    if (
      integerField(wrap, E2EE_ENVELOPE_FIELDS.dekWrap.epoch) !== epoch ||
      integerField(header, E2EE_ENVELOPE_FIELDS.objectHeader.epoch) !== epoch ||
      integerField(header, E2EE_ENVELOPE_FIELDS.objectHeader.chunkCount) !==
        1 ||
      integerField(chunk, E2EE_ENVELOPE_FIELDS.chunk.chunkCount) !== 1 ||
      chunk.get(E2EE_ENVELOPE_FIELDS.chunk.chunkIndex) !== 0 ||
      !bytesEqual(
        bytesField(
          header,
          E2EE_ENVELOPE_FIELDS.objectHeader.writerEndpointId,
          16,
        ),
        writerEndpointId,
      ) ||
      !bytesEqual(
        bytesField(header, E2EE_ENVELOPE_FIELDS.objectHeader.dekWrapRef, 32),
        await ancV1Hash("dek-wrap", dekWrapBytes),
      )
    )
      fail();

    const unsignedHeader = new Map(header);
    const signature = bytesField(
      unsignedHeader,
      E2EE_ENVELOPE_FIELDS.objectHeader.signature,
      64,
    );
    unsignedHeader.delete(E2EE_ENVELOPE_FIELDS.objectHeader.signature);
    if (
      !(await ancV1VerifyDetached(
        "object-header",
        encodeAncV1Canonical(unsignedHeader),
        signature,
        writerPublicKey,
      ))
    )
      fail();

    const wrapAad = new Map(wrap);
    const wrappedDataKey = bytesField(
      wrapAad,
      E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext,
    );
    wrapAad.delete(E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext);
    dataKey = await ancV1AeadDecrypt(
      "dek-wrap",
      wrappedDataKey,
      encodeAncV1Canonical(wrapAad),
      bytesField(wrap, E2EE_ENVELOPE_FIELDS.dekWrap.nonce, 24),
      epochKey,
    );
    if (dataKey.byteLength !== 32) fail();
    const plaintext = await ancV1SecretstreamDecryptOne(
      "chunk",
      bytesField(chunk, E2EE_ENVELOPE_FIELDS.chunk.secretstreamHeader, 24),
      bytesField(chunk, E2EE_ENVELOPE_FIELDS.chunk.ciphertext),
      chunkAad(objectId, revision),
      dataKey,
    );
    if (
      plaintext.byteLength !==
      integerField(header, E2EE_ENVELOPE_FIELDS.objectHeader.plaintextLength)
    ) {
      plaintext.fill(0);
      fail();
    }
    const contentType = textField(
      header,
      E2EE_ENVELOPE_FIELDS.objectHeader.contentType,
    );
    if (encoder.encode(contentType).byteLength > 120) {
      plaintext.fill(0);
      fail();
    }
    return Object.freeze({
      vaultId: vaultId.slice(),
      objectId: objectId.slice(),
      revision,
      epoch,
      writerEndpointId: writerEndpointId.slice(),
      createdAt,
      contentType,
      plaintext,
    });
  } catch (error) {
    if (error instanceof AncV1ObjectEnvelopeError) throw error;
    return fail();
  } finally {
    epochKey.fill(0);
    writerPublicKey.fill(0);
    dataKey?.fill(0);
  }
}
