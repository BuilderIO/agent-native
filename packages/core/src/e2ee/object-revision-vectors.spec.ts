import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import { openAncV1ObjectRevision } from "./object-envelope-codecs.js";
import {
  ancV1AeadDecrypt,
  ancV1Hash,
  ancV1SecretstreamDecryptOne,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS as F } from "./suite.js";

function map(value: unknown): Map<number, unknown> {
  if (!(value instanceof Map)) throw new Error("expected canonical map");
  return value;
}

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("expected bytes");
  return value;
}

describe("anc/v1 native object revision fixture", () => {
  it("independently authenticates and decrypts the native-bound bundle", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "./fixtures/anc-v1-object-revision-vectors.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const nativeParts = decodeAncV1Canonical(
      ancV1HexToBytes(String(fixture.bundleHex)),
    );
    if (!Array.isArray(nativeParts) || nativeParts.length !== 3)
      throw new Error();
    const dekBytes = bytes(nativeParts[0]);
    const headerBytes = bytes(nativeParts[1]);
    if (!Array.isArray(nativeParts[2]) || nativeParts[2].length !== 1)
      throw new Error();
    const chunkBytes = bytes(nativeParts[2][0]);
    // The fixture predates the explicit bundle discriminator. Reframe the
    // exact native-produced inner bytes under the frozen map wrapper; no
    // cryptographic byte is regenerated or trusted from TypeScript.
    const encodedBundle = encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [1, "anc/v1-object-bundle"],
        [2, dekBytes],
        [3, headerBytes],
        [4, [chunkBytes]],
      ]),
    );
    const dek = map(decodeAncV1Canonical(dekBytes));
    const header = map(decodeAncV1Canonical(headerBytes));
    const chunk = map(decodeAncV1Canonical(chunkBytes));

    const unsignedHeader = new Map(header);
    unsignedHeader.delete(F.objectHeader.signature);
    await expect(
      ancV1VerifyDetached(
        "object-header",
        encodeAncV1Canonical(unsignedHeader),
        bytes(header.get(F.objectHeader.signature)),
        ancV1HexToBytes(String(fixture.writerSigningPublicKeyHex)),
      ),
    ).resolves.toBe(true);
    await expect(ancV1Hash("dek-wrap", dekBytes)).resolves.toEqual(
      bytes(header.get(F.objectHeader.dekWrapRef)),
    );

    const dekAad = new Map(dek);
    dekAad.delete(F.dekWrap.ciphertext);
    const objectDek = await ancV1AeadDecrypt(
      "dek-wrap",
      bytes(dek.get(F.dekWrap.ciphertext)),
      encodeAncV1Canonical(dekAad),
      bytes(dek.get(F.dekWrap.nonce)),
      ancV1HexToBytes(String(fixture.epochKeyHex)),
    );
    const chunkAad = encodeAncV1Canonical(
      new Map<number, unknown>([
        [F.objectHeader.objectId, bytes(header.get(F.objectHeader.objectId))],
        [F.objectHeader.revision, header.get(F.objectHeader.revision)],
        [F.chunk.chunkIndex, chunk.get(F.chunk.chunkIndex)],
        [F.chunk.chunkCount, chunk.get(F.chunk.chunkCount)],
      ]),
    );
    const plaintext = await ancV1SecretstreamDecryptOne(
      "chunk",
      bytes(chunk.get(F.chunk.secretstreamHeader)),
      bytes(chunk.get(F.chunk.ciphertext)),
      chunkAad,
      objectDek,
    );
    objectDek.fill(0);
    expect(new TextDecoder().decode(plaintext)).toBe(fixture.plaintextUtf8);
    await expect(
      openAncV1ObjectRevision({
        encoded: encodedBundle,
        vaultId: ancV1HexToBytes(String(fixture.vaultIdHex)),
        objectId: ancV1HexToBytes(String(fixture.objectIdHex)),
        revision: Number(fixture.revision),
        epoch: Number(fixture.epoch),
        writerEndpointId: ancV1HexToBytes(String(fixture.writerEndpointIdHex)),
        epochKey: ancV1HexToBytes(String(fixture.epochKeyHex)),
        writerSigningPublicKey: ancV1HexToBytes(
          String(fixture.writerSigningPublicKeyHex),
        ),
      }),
    ).resolves.toMatchObject({
      revision: fixture.revision,
      epoch: fixture.epoch,
      contentType: fixture.contentType,
    });
    expect(
      Buffer.from(await ancV1Hash("object-header", headerBytes)).toString(
        "hex",
      ),
    ).toBe(fixture.revisionIdHex);
    expect(Buffer.from(encodedBundle).includes(Buffer.from("Moon"))).toBe(
      false,
    );
  });
});
