import { describe, expect, it } from "vitest";

import {
  ancV1AeadDecrypt,
  ancV1AeadEncrypt,
  ancV1BoxDecrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryRoot,
  ancV1Hash,
  ancV1PackNonceCiphertext,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  ancV1UnpackNonceCiphertext,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1VerifyDetached,
  ancV1VaultId,
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

  it("rejects malformed canonical recovery-root inputs and mnemonic text", async () => {
    expect(() => ancV1RecoveryEntropyFromBip39Bytes(pattern(0x01, 31))).toThrow(
      /exactly 32 bytes/,
    );
    expect(() => ancV1VaultId(pattern(0x02, 15))).toThrow(/exactly 16 bytes/);

    await expect(
      ancV1DeriveRecoveryRoot({
        recoveryEntropy: ancV1RecoveryEntropyFromBip39Bytes(pattern(0x01, 32)),
        vaultId: pattern(0x02, 17) as ReturnType<typeof ancV1VaultId>,
      }),
    ).rejects.toThrow(/exactly 16 bytes/);

    await expect(
      ancV1DeriveRecoveryRoot({
        recoveryEntropy: "e\u0301" as unknown as ReturnType<
          typeof ancV1RecoveryEntropyFromBip39Bytes
        >,
        vaultId: ancV1VaultId(pattern(0x02, 16)),
      }),
    ).rejects.toThrow(/exactly 32 bytes/);
    await expect(
      ancV1DeriveRecoveryRoot({
        recoveryEntropy: "\u00e9" as unknown as ReturnType<
          typeof ancV1RecoveryEntropyFromBip39Bytes
        >,
        vaultId: ancV1VaultId(pattern(0x02, 16)),
      }),
    ).rejects.toThrow(/exactly 32 bytes/);
  });

  it("snapshots each recovery input once with intrinsic TypedArray semantics", async () => {
    const originalEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    );
    const originalVaultId = ancV1VaultId(
      Uint8Array.from({ length: 16 }, (_, index) => index),
    );
    const expected = await ancV1DeriveRecoveryRoot({
      recoveryEntropy: originalEntropy,
      vaultId: originalVaultId,
    });
    const entropyForGetter = ancV1RecoveryEntropyFromBip39Bytes(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    );
    const vaultForGetter = ancV1VaultId(
      Uint8Array.from({ length: 16 }, (_, index) => index),
    );
    let entropyReads = 0;
    let vaultReads = 0;
    const getterInput = {
      get recoveryEntropy() {
        entropyReads += 1;
        return entropyReads === 1
          ? entropyForGetter
          : ancV1RecoveryEntropyFromBip39Bytes(pattern(0xff, 32));
      },
      get vaultId() {
        vaultReads += 1;
        entropyForGetter.fill(0xff);
        return vaultReads === 1
          ? vaultForGetter
          : ancV1VaultId(pattern(0xff, 16));
      },
    };
    const fromGetters = await ancV1DeriveRecoveryRoot(getterInput);
    expect(fromGetters).toEqual(expected);
    expect({ entropyReads, vaultReads }).toEqual({
      entropyReads: 1,
      vaultReads: 1,
    });

    class HostileSlice extends Uint8Array {
      override slice(): Uint8Array {
        return pattern(0xff, this.length);
      }
    }
    const subclassEntropy = new HostileSlice(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    ) as ReturnType<typeof ancV1RecoveryEntropyFromBip39Bytes>;
    const subclassVaultId = new HostileSlice(
      Uint8Array.from({ length: 16 }, (_, index) => index),
    ) as ReturnType<typeof ancV1VaultId>;
    await expect(
      ancV1DeriveRecoveryRoot({
        recoveryEntropy: subclassEntropy,
        vaultId: subclassVaultId,
      }),
    ).resolves.toEqual(expected);

    const proxiedEntropy = new Proxy(originalEntropy, {});
    await expect(
      ancV1DeriveRecoveryRoot({
        recoveryEntropy: proxiedEntropy,
        vaultId: originalVaultId,
      }),
    ).rejects.toThrow(/exactly 32 bytes/);

    expected.fill(0);
    fromGetters.fill(0);
    originalEntropy.fill(0);
    originalVaultId.fill(0);
    entropyForGetter.fill(0);
    vaultForGetter.fill(0);
    subclassEntropy.fill(0);
    subclassVaultId.fill(0);
  });

  it("round-trips nonce-prefixed opaque payloads", () => {
    const nonce = pattern(0x99, 24);
    const ciphertext = pattern(0xaa, 48);
    expect(
      ancV1UnpackNonceCiphertext(ancV1PackNonceCiphertext(nonce, ciphertext)),
    ).toEqual({ nonce, ciphertext });
  });
});
