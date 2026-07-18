import {
  ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX,
  ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX,
  ancV1AeadEncrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryRoot,
  ancV1Hash,
  ancV1PatternBytes,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  ancV1VaultId,
  buildAncV1InteroperabilityVectors,
} from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import { SodiumNativeAncV1CryptoProvider } from "./sodium-native.js";

const native = new SodiumNativeAncV1CryptoProvider();
const text = (value: string) => new TextEncoder().encode(value);

describe("SodiumNativeAncV1CryptoProvider", () => {
  it("matches Core hashes, seeded keys, signatures, AEAD, and boxes exactly", async () => {
    const payload = text("synthetic native parity payload");
    const aad = text("synthetic parity aad");
    const signingSeed = ancV1PatternBytes(0x11, 32);
    const senderSeed = ancV1PatternBytes(0x44, 32);
    const recipientSeed = ancV1PatternBytes(0x55, 32);
    const nonce = ancV1PatternBytes(0x33, 24);
    const key = ancV1PatternBytes(0x22, 32);

    const signing = native.signingKeypairFromSeed(signingSeed);
    const coreSigning = await ancV1SigningKeypairFromSeed(signingSeed);
    expect(signing).toEqual(coreSigning);
    expect(native.hash("manifest", payload)).toEqual(
      await ancV1Hash("manifest", payload),
    );
    expect(
      native.signDetached("manifest", payload, signing.privateKey),
    ).toEqual(
      await ancV1SignDetached("manifest", payload, coreSigning.privateKey),
    );
    expect(
      native.verifyDetached(
        "manifest",
        payload,
        native.signDetached("manifest", payload, signing.privateKey),
        signing.publicKey,
      ),
    ).toBe(true);

    const sender = native.boxKeypairFromSeed(senderSeed);
    const recipient = native.boxKeypairFromSeed(recipientSeed);
    expect(sender).toEqual(await ancV1BoxKeypairFromSeed(senderSeed));
    expect(recipient).toEqual(await ancV1BoxKeypairFromSeed(recipientSeed));

    expect(native.aeadEncrypt("job", payload, aad, nonce, key)).toEqual(
      await ancV1AeadEncrypt("job", payload, aad, nonce, key),
    );
    expect(
      native.boxEncrypt(
        "eek-wrap",
        payload,
        nonce,
        recipient.publicKey,
        sender.privateKey,
      ),
    ).toEqual(
      await ancV1BoxEncrypt(
        "eek-wrap",
        payload,
        nonce,
        recipient.publicKey,
        sender.privateKey,
      ),
    );
  });

  it("matches the frozen Core vector key material", async () => {
    const core = await buildAncV1InteroperabilityVectors();
    const signing = native.signingKeypairFromSeed(ancV1PatternBytes(0x11, 32));

    expect(signing.publicKey).toEqual(core.materials.signingPublicKey);
  });

  it("matches the frozen Core entropy-and-vault recovery derivation", async () => {
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      ancV1PatternBytes(0x65, 32),
    );
    const vaultId = ancV1VaultId(ancV1PatternBytes(0x66, 16));
    const expected = await ancV1DeriveRecoveryRoot({
      recoveryEntropy,
      vaultId,
    });
    const actual = native.deriveRecoveryRoot(recoveryEntropy, vaultId);

    expect(actual).toEqual(expected);
    expect(recoveryEntropy).toEqual(ancV1PatternBytes(0x65, 32));
    expect(vaultId).toEqual(ancV1PatternBytes(0x66, 16));

    actual.fill(0);
    expected.fill(0);
    recoveryEntropy.fill(0);
    vaultId.fill(0);
  });

  it("rejects malformed recovery entropy and vault IDs", () => {
    expect(() =>
      native.deriveRecoveryRoot(
        ancV1PatternBytes(0x65, 31) as ReturnType<
          typeof ancV1RecoveryEntropyFromBip39Bytes
        >,
        ancV1VaultId(ancV1PatternBytes(0x66, 16)),
      ),
    ).toThrow("BIP39 recovery entropy must be exactly 32 bytes");
    expect(() =>
      native.deriveRecoveryRoot(
        ancV1RecoveryEntropyFromBip39Bytes(ancV1PatternBytes(0x65, 32)),
        ancV1PatternBytes(0x66, 15) as ReturnType<typeof ancV1VaultId>,
      ),
    ).toThrow("Vault ID must be exactly 16 bytes");
  });

  it("uses intrinsic snapshots and rejects proxied TypedArrays", () => {
    class HostileSlice extends Uint8Array {
      override slice(): Uint8Array {
        return ancV1PatternBytes(0xff, this.length);
      }
    }
    const entropy = new HostileSlice(ancV1PatternBytes(0x65, 32)) as ReturnType<
      typeof ancV1RecoveryEntropyFromBip39Bytes
    >;
    const vaultId = new HostileSlice(ancV1PatternBytes(0x66, 16)) as ReturnType<
      typeof ancV1VaultId
    >;
    const expected = native.deriveRecoveryRoot(
      ancV1RecoveryEntropyFromBip39Bytes(ancV1PatternBytes(0x65, 32)),
      ancV1VaultId(ancV1PatternBytes(0x66, 16)),
    );
    expect(native.deriveRecoveryRoot(entropy, vaultId)).toEqual(expected);
    expect(() =>
      native.deriveRecoveryRoot(new Proxy(entropy, {}), vaultId),
    ).toThrow("BIP39 recovery entropy must be exactly 32 bytes");
    expected.fill(0);
    entropy.fill(0);
    vaultId.fill(0);
  });

  it("decrypts the pinned Core secretstream fixture and round-trips new frames", async () => {
    const { materials } = await buildAncV1InteroperabilityVectors();
    const pinned = native.secretstreamDecryptOne(
      "chunk",
      Buffer.from(ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX, "hex"),
      Buffer.from(ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX, "hex"),
      materials.chunkAad,
      materials.chunkKey,
    );
    expect(new TextDecoder().decode(pinned)).toBe("synthetic chunk bytes");

    const plaintext = text("new native secretstream frame");
    const encrypted = native.secretstreamEncryptOne(
      "chunk",
      plaintext,
      materials.chunkAad,
      materials.chunkKey,
    );
    expect(
      native.secretstreamDecryptOne(
        "chunk",
        encrypted.header,
        encrypted.ciphertext,
        materials.chunkAad,
        materials.chunkKey,
      ),
    ).toEqual(plaintext);
  });

  it("fails closed for tampering, wrong domains, wrong keys, and invalid lengths", () => {
    const plaintext = text("protected plaintext");
    const aad = text("bounded aad");
    const nonce = ancV1PatternBytes(0x20, 24);
    const key = ancV1PatternBytes(0x30, 32);
    const wrongKey = ancV1PatternBytes(0x31, 32);
    const aead = native.aeadEncrypt("job", plaintext, aad, nonce, key);
    aead[0] ^= 1;

    expect(() => native.aeadDecrypt("job", aead, aad, nonce, key)).toThrow(
      "AEAD authentication failed",
    );
    expect(() =>
      native.aeadDecrypt(
        "job",
        native.aeadEncrypt("job", plaintext, aad, nonce, key),
        aad,
        nonce,
        wrongKey,
      ),
    ).toThrow("AEAD authentication failed");
    expect(() =>
      native.aeadEncrypt("job", plaintext, aad, nonce, key.slice(1)),
    ).toThrow("AEAD key must be exactly 32 bytes");
    expect(() => native.signingKeypairFromSeed(new Uint8Array(31))).toThrow(
      "Signing seed must be exactly 32 bytes",
    );

    const sender = native.boxKeypairFromSeed(ancV1PatternBytes(0x40, 32));
    const recipient = native.boxKeypairFromSeed(ancV1PatternBytes(0x41, 32));
    const boxed = native.boxEncrypt(
      "eek-wrap",
      plaintext,
      nonce,
      recipient.publicKey,
      sender.privateKey,
    );
    expect(() =>
      native.boxDecrypt(
        "dek-wrap",
        boxed,
        nonce,
        sender.publicKey,
        recipient.privateKey,
      ),
    ).toThrow("Box domain separation failed");

    boxed[0] ^= 1;
    expect(() =>
      native.boxDecrypt(
        "eek-wrap",
        boxed,
        nonce,
        sender.publicKey,
        recipient.privateKey,
      ),
    ).toThrow("Box authentication failed");

    const signing = native.signingKeypairFromSeed(ancV1PatternBytes(0x42, 32));
    const validSignature = native.signDetached(
      "manifest",
      plaintext,
      signing.privateKey,
    );
    expect(
      native.verifyDetached(
        "job",
        plaintext,
        validSignature,
        signing.publicKey,
      ),
    ).toBe(false);
    expect(validSignature).toHaveLength(64);
  });

  it("rejects tampered secretstream frames", async () => {
    const { materials } = await buildAncV1InteroperabilityVectors();
    const encrypted = native.secretstreamEncryptOne(
      "chunk",
      text("protected chunk"),
      materials.chunkAad,
      materials.chunkKey,
    );
    encrypted.ciphertext[0] ^= 1;
    expect(() =>
      native.secretstreamDecryptOne(
        "chunk",
        encrypted.header,
        encrypted.ciphertext,
        materials.chunkAad,
        materials.chunkKey,
      ),
    ).toThrow("Secretstream authentication failed");
  });

  it("returns independent random bytes and zeroizes caller buffers", () => {
    const first = native.randomBytes(32);
    const second = native.randomBytes(32);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    native.zeroize(first);
    expect(first).toEqual(new Uint8Array(32));
    expect(() => native.randomBytes(0)).toThrow(
      "Random byte length must be a positive integer",
    );
  });

  it("preserves caller-owned inputs and returns independently owned secrets", () => {
    const seed = ancV1PatternBytes(0x51, 32);
    const seedSnapshot = Uint8Array.from(seed);
    const pair = native.signingKeypairFromSeed(seed);
    const publicKeySnapshot = Uint8Array.from(pair.publicKey);
    native.zeroize(pair.privateKey);
    expect(seed).toEqual(seedSnapshot);
    expect(pair.publicKey).toEqual(publicKeySnapshot);

    const plaintext = text("caller-owned plaintext");
    const plaintextSnapshot = Uint8Array.from(plaintext);
    const aad = text("caller-owned aad");
    const aadSnapshot = Uint8Array.from(aad);
    const nonce = ancV1PatternBytes(0x52, 24);
    const key = ancV1PatternBytes(0x53, 32);
    const ciphertext = native.aeadEncrypt("job", plaintext, aad, nonce, key);
    const ciphertextSnapshot = Uint8Array.from(ciphertext);
    const decrypted = native.aeadDecrypt("job", ciphertext, aad, nonce, key);

    expect(decrypted).toEqual(plaintextSnapshot);
    expect(plaintext).toEqual(plaintextSnapshot);
    expect(aad).toEqual(aadSnapshot);
    native.zeroize(decrypted);
    expect(ciphertext).toEqual(ciphertextSnapshot);
  });
});
