import { describe, expect, it } from "vitest";

import {
  AncV1ObjectEnvelopeError,
  openAncV1ObjectRevision,
  sealAncV1ObjectRevision,
} from "./object-envelope-codecs.js";
import { ancV1SigningKeypairFromSeed } from "./portable-crypto.js";

function bytes(length: number, start: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

async function fixture() {
  const signing = await ancV1SigningKeypairFromSeed(bytes(32, 0x71));
  const input = {
    vaultId: bytes(16, 0x11),
    objectId: bytes(16, 0x21),
    revision: 3,
    epoch: 7,
    writerEndpointId: bytes(16, 0x31),
    createdAt: 1_721_111_111,
    dekWrapEnvelopeId: bytes(16, 0x41),
    objectHeaderEnvelopeId: bytes(16, 0x51),
    chunkEnvelopeId: bytes(16, 0x61),
    contentType: "application/vnd.agent-native.content-document+json",
    plaintext: new TextEncoder().encode(
      '{"content":"A private thought","title":"Lantern"}',
    ),
    epochKey: bytes(32, 0x81),
    dataKey: bytes(32, 0xa1),
    dekWrapNonce: bytes(24, 0xc1),
    writerSigningPrivateKey: signing.privateKey,
  };
  return { input, signing };
}

describe("anc/v1 object revision envelope", () => {
  it("round-trips one signed, EEK-wrapped, final secretstream revision", async () => {
    const { input, signing } = await fixture();
    const encoded = await sealAncV1ObjectRevision(input);
    const opened = await openAncV1ObjectRevision({
      encoded,
      vaultId: input.vaultId,
      objectId: input.objectId,
      revision: input.revision,
      epoch: input.epoch,
      writerEndpointId: input.writerEndpointId,
      epochKey: input.epochKey,
      writerSigningPublicKey: signing.publicKey,
    });

    expect(opened).toMatchObject({
      revision: 3,
      epoch: 7,
      createdAt: 1_721_111_111,
      contentType: "application/vnd.agent-native.content-document+json",
    });
    expect(opened.plaintext).toEqual(input.plaintext);
    expect(opened.vaultId).toEqual(input.vaultId);
    expect(opened.objectId).toEqual(input.objectId);
    expect(opened.writerEndpointId).toEqual(input.writerEndpointId);
  });

  it("rejects ciphertext, EEK, writer, vault, object, revision, and epoch substitution", async () => {
    const { input, signing } = await fixture();
    const encoded = await sealAncV1ObjectRevision(input);
    const base = {
      encoded,
      vaultId: input.vaultId,
      objectId: input.objectId,
      revision: input.revision,
      epoch: input.epoch,
      writerEndpointId: input.writerEndpointId,
      epochKey: input.epochKey,
      writerSigningPublicKey: signing.publicKey,
    };
    const tampered = encoded.slice();
    tampered[tampered.length - 1]! ^= 1;
    const hostile = [
      { ...base, encoded: tampered },
      { ...base, epochKey: bytes(32, 0xe1) },
      { ...base, writerSigningPublicKey: bytes(32, 0xe2) },
      { ...base, vaultId: bytes(16, 0xe3) },
      { ...base, objectId: bytes(16, 0xe4) },
      { ...base, revision: 4 },
      { ...base, epoch: 8 },
      { ...base, writerEndpointId: bytes(16, 0xe5) },
    ];
    for (const candidate of hostile) {
      await expect(openAncV1ObjectRevision(candidate)).rejects.toBeInstanceOf(
        AncV1ObjectEnvelopeError,
      );
    }
  });

  it("snapshots caller buffers before asynchronous cryptography", async () => {
    const { input, signing } = await fixture();
    const expectedVault = input.vaultId.slice();
    const expectedObject = input.objectId.slice();
    const expectedPlaintext = input.plaintext.slice();
    const sealing = sealAncV1ObjectRevision(input);
    input.vaultId.fill(0xff);
    input.objectId.fill(0xff);
    input.plaintext.fill(0xff);
    input.epochKey.fill(0xff);
    input.dataKey.fill(0xff);
    input.writerSigningPrivateKey.fill(0xff);
    const encoded = await sealing;

    const opened = await openAncV1ObjectRevision({
      encoded,
      vaultId: expectedVault,
      objectId: expectedObject,
      revision: input.revision,
      epoch: input.epoch,
      writerEndpointId: input.writerEndpointId,
      epochKey: bytes(32, 0x81),
      writerSigningPublicKey: signing.publicKey,
    });
    expect(opened.plaintext).toEqual(expectedPlaintext);
  });

  it("rejects empty, oversized, and malformed coordinates before release", async () => {
    const { input } = await fixture();
    await expect(
      sealAncV1ObjectRevision({ ...input, plaintext: new Uint8Array() }),
    ).rejects.toBeInstanceOf(AncV1ObjectEnvelopeError);
    await expect(
      sealAncV1ObjectRevision({ ...input, vaultId: bytes(15, 1) }),
    ).rejects.toBeInstanceOf(AncV1ObjectEnvelopeError);
    await expect(
      sealAncV1ObjectRevision({ ...input, revision: 0 }),
    ).rejects.toBeInstanceOf(AncV1ObjectEnvelopeError);
  });
});
