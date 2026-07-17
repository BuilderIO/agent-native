import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ANC_V1_EXPECTED_VECTOR_HEX,
  ANC_V1_SYNTHETIC_PATTERNS,
  ANC_V1_VECTOR_NAMES,
  ancV1PatternBytes,
  buildAncV1InteroperabilityVectors,
  type AncV1VectorName,
} from "./interoperability-vectors.js";
import {
  ancV1AeadDecrypt,
  ancV1BoxDecrypt,
  ancV1SecretstreamDecryptOne,
  ancV1UnpackNonceCiphertext,
  ancV1VerifyDetached,
  AncV1CryptoError,
} from "./portable-crypto.js";
import { type E2EEDomainTag, E2EE_ENVELOPE_FIELDS } from "./suite.js";

function envelope(bytes: Uint8Array): Map<number, AncV1CanonicalValue> {
  const value = decodeAncV1Canonical(bytes, { maxBytes: 64 * 1024 });
  expect(value).toBeInstanceOf(Map);
  return value as Map<number, AncV1CanonicalValue>;
}

function bytesField(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
): Uint8Array {
  const value = map.get(key);
  expect(value).toBeInstanceOf(Uint8Array);
  return value as Uint8Array;
}

const SIGNED_VECTORS: Readonly<
  Partial<Record<AncV1VectorName, [E2EEDomainTag, number]>>
> = {
  endpoint: ["endpoint", E2EE_ENVELOPE_FIELDS.endpoint.signature],
  epoch: ["epoch", E2EE_ENVELOPE_FIELDS.epoch.signature],
  "eek-wrap": ["eek-wrap", E2EE_ENVELOPE_FIELDS.eekWrap.signature],
  "object-header": [
    "object-header",
    E2EE_ENVELOPE_FIELDS.objectHeader.signature,
  ],
  grant: ["grant", E2EE_ENVELOPE_FIELDS.grant.signature],
  disclosure: ["disclosure", E2EE_ENVELOPE_FIELDS.disclosure.signature],
  job: ["job", E2EE_ENVELOPE_FIELDS.job.signature],
  result: ["result", E2EE_ENVELOPE_FIELDS.result.signature],
  "log-entry": ["log-entry", E2EE_ENVELOPE_FIELDS.logEntry.signature],
  manifest: ["manifest", E2EE_ENVELOPE_FIELDS.manifest.signature],
  tombstone: ["tombstone", 213],
};

describe("anc/v1 fixed interoperability corpus", () => {
  it("pins all fourteen canonical envelope bytes exactly", async () => {
    const { vectors } = await buildAncV1InteroperabilityVectors();
    expect(Object.keys(ANC_V1_EXPECTED_VECTOR_HEX).sort()).toEqual(
      [...ANC_V1_VECTOR_NAMES].sort(),
    );
    for (const name of ANC_V1_VECTOR_NAMES) {
      expect(ANC_V1_EXPECTED_VECTOR_HEX[name], name).not.toBe("");
      expect(ancV1BytesToHex(vectors[name]), name).toBe(
        ANC_V1_EXPECTED_VECTOR_HEX[name],
      );
      expect(encodeAncV1Canonical(envelope(vectors[name])), name).toEqual(
        vectors[name],
      );
    }
  });

  it("verifies every signed envelope against its canonical unsigned bytes", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();
    for (const [name, definition] of Object.entries(SIGNED_VECTORS)) {
      const [tag, signatureField] = definition!;
      const signed = envelope(vectors[name as AncV1VectorName]);
      const signature = bytesField(signed, signatureField);
      const unsigned = new Map(signed);
      unsigned.delete(signatureField);
      await expect(
        ancV1VerifyDetached(
          tag,
          encodeAncV1Canonical(unsigned),
          signature,
          materials.signingPublicKey,
        ),
        name,
      ).resolves.toBe(true);
    }
  });

  it("decrypts the endpoint EEK wrap and rejects the wrong domain", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();
    const map = envelope(vectors["eek-wrap"]);
    const ciphertext = bytesField(map, E2EE_ENVELOPE_FIELDS.eekWrap.ciphertext);
    const nonce = bytesField(map, E2EE_ENVELOPE_FIELDS.eekWrap.nonce);
    await expect(
      ancV1BoxDecrypt(
        "eek-wrap",
        ciphertext,
        nonce,
        materials.senderBoxPublicKey,
        materials.recipientBoxPrivateKey,
      ),
    ).resolves.toEqual(materials.eek);
    await expect(
      ancV1BoxDecrypt(
        "dek-wrap",
        ciphertext,
        nonce,
        materials.senderBoxPublicKey,
        materials.recipientBoxPrivateKey,
      ),
    ).rejects.toBeInstanceOf(AncV1CryptoError);
  });

  it("decrypts the DEK, job, result, recovery, and pinned secretstream chunk", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();

    const dekMap = envelope(vectors["dek-wrap"]);
    const dekCiphertext = bytesField(
      dekMap,
      E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext,
    );
    const dekAad = new Map(dekMap);
    dekAad.delete(E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext);
    await expect(
      ancV1AeadDecrypt(
        "dek-wrap",
        dekCiphertext,
        encodeAncV1Canonical(dekAad),
        bytesField(dekMap, E2EE_ENVELOPE_FIELDS.dekWrap.nonce),
        materials.eek,
      ),
    ).resolves.toEqual(materials.dek);

    const jobMap = envelope(vectors.job);
    const jobAad = new Map(jobMap);
    jobAad.delete(E2EE_ENVELOPE_FIELDS.job.ciphertext);
    jobAad.delete(E2EE_ENVELOPE_FIELDS.job.signature);
    const jobPayload = ancV1UnpackNonceCiphertext(
      bytesField(jobMap, E2EE_ENVELOPE_FIELDS.job.ciphertext),
    );
    expect(jobPayload.nonce).toEqual(
      ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.jobNonce, 24),
    );
    await expect(
      ancV1AeadDecrypt(
        "job",
        jobPayload.ciphertext,
        encodeAncV1Canonical(jobAad),
        jobPayload.nonce,
        materials.jobKey,
      ),
    ).resolves.toEqual(
      new TextEncoder().encode("synthetic encrypted job request"),
    );

    const resultMap = envelope(vectors.result);
    const resultAad = new Map(resultMap);
    resultAad.delete(E2EE_ENVELOPE_FIELDS.result.ciphertext);
    resultAad.delete(E2EE_ENVELOPE_FIELDS.result.signature);
    const resultPayload = ancV1UnpackNonceCiphertext(
      bytesField(resultMap, E2EE_ENVELOPE_FIELDS.result.ciphertext),
    );
    expect(resultPayload.nonce).toEqual(
      ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.resultNonce, 24),
    );
    await expect(
      ancV1AeadDecrypt(
        "result",
        resultPayload.ciphertext,
        encodeAncV1Canonical(resultAad),
        resultPayload.nonce,
        materials.resultKey,
      ),
    ).resolves.toEqual(
      new TextEncoder().encode("synthetic encrypted job result"),
    );

    const recoveryMap = envelope(vectors.recovery);
    const recoveryAad = new Map(recoveryMap);
    recoveryAad.delete(E2EE_ENVELOPE_FIELDS.recovery.ciphertext);
    await expect(
      ancV1AeadDecrypt(
        "recovery",
        bytesField(recoveryMap, E2EE_ENVELOPE_FIELDS.recovery.ciphertext),
        encodeAncV1Canonical(recoveryAad),
        bytesField(recoveryMap, E2EE_ENVELOPE_FIELDS.recovery.nonce),
        materials.recoveryKey,
      ),
    ).resolves.toEqual(materials.eek);

    const chunkMap = envelope(vectors.chunk);
    await expect(
      ancV1SecretstreamDecryptOne(
        "chunk",
        bytesField(chunkMap, E2EE_ENVELOPE_FIELDS.chunk.secretstreamHeader),
        bytesField(chunkMap, E2EE_ENVELOPE_FIELDS.chunk.ciphertext),
        materials.chunkAad,
        materials.chunkKey,
      ),
    ).resolves.toEqual(new TextEncoder().encode("synthetic chunk bytes"));
  });

  it("rejects corrupted canonical bytes and authenticated ciphertext", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();
    const corruptedEnvelope = vectors.endpoint.slice();
    corruptedEnvelope[corruptedEnvelope.length - 1] ^= 0x01;
    const endpointMap = envelope(corruptedEnvelope);
    const signature = bytesField(
      endpointMap,
      E2EE_ENVELOPE_FIELDS.endpoint.signature,
    );
    endpointMap.delete(E2EE_ENVELOPE_FIELDS.endpoint.signature);
    await expect(
      ancV1VerifyDetached(
        "endpoint",
        encodeAncV1Canonical(endpointMap),
        signature,
        materials.signingPublicKey,
      ),
    ).resolves.toBe(false);

    const chunkMap = envelope(vectors.chunk);
    const corruptedChunk = bytesField(
      chunkMap,
      E2EE_ENVELOPE_FIELDS.chunk.ciphertext,
    ).slice();
    corruptedChunk[0] ^= 0x01;
    await expect(
      ancV1SecretstreamDecryptOne(
        "chunk",
        bytesField(chunkMap, E2EE_ENVELOPE_FIELDS.chunk.secretstreamHeader),
        corruptedChunk,
        materials.chunkAad,
        materials.chunkKey,
      ),
    ).rejects.toBeInstanceOf(AncV1CryptoError);
  });
});
