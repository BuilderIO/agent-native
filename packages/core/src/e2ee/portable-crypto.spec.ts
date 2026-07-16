import { describe, expect, it } from "vitest";

import {
  ancV1AeadDecrypt,
  ancV1AeadEncrypt,
  ancV1BoxDecrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryKey,
  ancV1Hash,
  ancV1PackNonceCiphertext,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  ancV1UnpackNonceCiphertext,
  ancV1VerifyDetached,
  AncV1CryptoError,
} from "./portable-crypto.js";

function pattern(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

describe("anc/v1 portable crypto wrappers", () => {
  it("domain-separates hashes and signatures", async () => {
    const payload = new TextEncoder().encode(
      "synthetic interoperability payload",
    );
    const seed = pattern(0x11, 32);
    const keys = await ancV1SigningKeypairFromSeed(seed);
    const signature = await ancV1SignDetached(
      "grant",
      payload,
      keys.privateKey,
    );

    await expect(ancV1Hash("grant", payload)).resolves.not.toEqual(
      await ancV1Hash("job", payload),
    );
    await expect(
      ancV1VerifyDetached("grant", payload, signature, keys.publicKey),
    ).resolves.toBe(true);
    await expect(
      ancV1VerifyDetached("job", payload, signature, keys.publicKey),
    ).resolves.toBe(false);
  });

  it("authenticates XChaCha20-Poly1305 ciphertext and associated data", async () => {
    const key = pattern(0x22, 32);
    const nonce = pattern(0x33, 24);
    const plaintext = new TextEncoder().encode("synthetic object bytes");
    const aad = new TextEncoder().encode("synthetic object header");
    const ciphertext = await ancV1AeadEncrypt(
      "dek-wrap",
      plaintext,
      aad,
      nonce,
      key,
    );
    await expect(
      ancV1AeadDecrypt("dek-wrap", ciphertext, aad, nonce, key),
    ).resolves.toEqual(plaintext);
    await expect(
      ancV1AeadDecrypt("job", ciphertext, aad, nonce, key),
    ).rejects.toBeInstanceOf(AncV1CryptoError);
  });

  it("binds deterministic endpoint box wraps to their domain", async () => {
    const sender = await ancV1BoxKeypairFromSeed(pattern(0x44, 32));
    const recipient = await ancV1BoxKeypairFromSeed(pattern(0x55, 32));
    const nonce = pattern(0x66, 24);
    const plaintext = pattern(0x77, 32);
    const ciphertext = await ancV1BoxEncrypt(
      "eek-wrap",
      plaintext,
      nonce,
      recipient.publicKey,
      sender.privateKey,
    );
    await expect(
      ancV1BoxDecrypt(
        "eek-wrap",
        ciphertext,
        nonce,
        sender.publicKey,
        recipient.privateKey,
      ),
    ).resolves.toEqual(plaintext);
    await expect(
      ancV1BoxDecrypt(
        "dek-wrap",
        ciphertext,
        nonce,
        sender.publicKey,
        recipient.privateKey,
      ),
    ).rejects.toBeInstanceOf(AncV1CryptoError);
  });

  it("derives a fixed-length Argon2id recovery key", async () => {
    const key = await ancV1DeriveRecoveryKey(
      "synthetic recovery phrase for interoperability only",
      pattern(0x88, 16),
      { opsLimit: 2, memLimit: 67_108_864 },
    );
    expect(key).toHaveLength(32);
  });

  it("round-trips nonce-prefixed opaque payloads", () => {
    const nonce = pattern(0x99, 24);
    const ciphertext = pattern(0xaa, 48);
    expect(
      ancV1UnpackNonceCiphertext(ancV1PackNonceCiphertext(nonce, ciphertext)),
    ).toEqual({ nonce, ciphertext });
  });
});
