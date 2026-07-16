import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX,
  ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX,
  buildAncV1InteroperabilityVectors,
} from "./interoperability-vectors.js";
import {
  ancV1AeadEncrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryKey,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import { type E2EEDomainTag, e2eeDomainSeparationPrefix } from "./suite.js";

interface NativeSodium {
  crypto_sign_PUBLICKEYBYTES: number;
  crypto_sign_SECRETKEYBYTES: number;
  crypto_sign_BYTES: number;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_SECRETKEYBYTES: number;
  crypto_box_MACBYTES: number;
  crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  crypto_pwhash_ALG_ARGON2ID13: number;
  crypto_secretstream_xchacha20poly1305_STATEBYTES: number;
  crypto_secretstream_xchacha20poly1305_ABYTES: number;
  crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
  crypto_generichash(out: Buffer, input: Buffer, key?: Buffer | null): void;
  crypto_sign_seed_keypair(
    publicKey: Buffer,
    privateKey: Buffer,
    seed: Buffer,
  ): void;
  crypto_sign_detached(
    signature: Buffer,
    message: Buffer,
    privateKey: Buffer,
  ): void;
  crypto_box_seed_keypair(
    publicKey: Buffer,
    privateKey: Buffer,
    seed: Buffer,
  ): void;
  crypto_box_easy(
    ciphertext: Buffer,
    plaintext: Buffer,
    nonce: Buffer,
    recipientPublicKey: Buffer,
    senderPrivateKey: Buffer,
  ): void;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext: Buffer,
    plaintext: Buffer,
    associatedData: Buffer,
    nsec: null,
    nonce: Buffer,
    key: Buffer,
  ): void;
  crypto_pwhash(
    output: Buffer,
    password: Buffer,
    salt: Buffer,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
  ): void;
  crypto_secretstream_xchacha20poly1305_init_pull(
    state: Buffer,
    header: Buffer,
    key: Buffer,
  ): void;
  crypto_secretstream_xchacha20poly1305_pull(
    state: Buffer,
    plaintext: Buffer,
    tag: Buffer,
    ciphertext: Buffer,
    associatedData: Buffer,
  ): void;
}

const require = createRequire(import.meta.url);
const sodium = require("sodium-native") as NativeSodium;

function pattern(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

function concat(...parts: readonly Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function domainMessage(tag: E2EEDomainTag, payload: Uint8Array): Buffer {
  return concat(e2eeDomainSeparationPrefix(tag), payload);
}

function domainAssociatedData(
  tag: E2EEDomainTag,
  associatedData: Uint8Array,
): Buffer {
  return concat(e2eeDomainSeparationPrefix(tag), associatedData);
}

describe("anc/v1 native and WASM libsodium parity", () => {
  it("matches BLAKE2b hashes, Ed25519 keys, and detached signatures", async () => {
    const payload = new TextEncoder().encode("synthetic native parity payload");
    const seed = pattern(0x11, 32);
    const wasmKeys = await ancV1SigningKeypairFromSeed(seed);

    const nativePublicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const nativePrivateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_seed_keypair(
      nativePublicKey,
      nativePrivateKey,
      Buffer.from(seed),
    );
    expect(nativePublicKey).toEqual(Buffer.from(wasmKeys.publicKey));
    expect(nativePrivateKey).toEqual(Buffer.from(wasmKeys.privateKey));

    const nativeHash = Buffer.alloc(32);
    sodium.crypto_generichash(
      nativeHash,
      domainMessage("manifest", payload),
      null,
    );
    expect(nativeHash).toEqual(
      Buffer.from(await ancV1Hash("manifest", payload)),
    );

    const nativeSignature = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(
      nativeSignature,
      domainMessage("manifest", payload),
      nativePrivateKey,
    );
    expect(nativeSignature).toEqual(
      Buffer.from(
        await ancV1SignDetached("manifest", payload, wasmKeys.privateKey),
      ),
    );
  });

  it("matches XChaCha20-Poly1305 and crypto_box ciphertext exactly", async () => {
    const plaintext = new TextEncoder().encode("synthetic parity plaintext");
    const aad = new TextEncoder().encode("synthetic parity aad");
    const key = pattern(0x22, 32);
    const nonce = pattern(0x33, 24);
    const wasmAead = await ancV1AeadEncrypt("job", plaintext, aad, nonce, key);
    const nativeAead = Buffer.alloc(
      plaintext.byteLength + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
    );
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      nativeAead,
      Buffer.from(plaintext),
      domainAssociatedData("job", aad),
      null,
      Buffer.from(nonce),
      Buffer.from(key),
    );
    expect(nativeAead).toEqual(Buffer.from(wasmAead));

    const senderSeed = pattern(0x44, 32);
    const recipientSeed = pattern(0x55, 32);
    const wasmSender = await ancV1BoxKeypairFromSeed(senderSeed);
    const wasmRecipient = await ancV1BoxKeypairFromSeed(recipientSeed);
    const nativeSenderPublic = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
    const nativeSenderPrivate = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
    const nativeRecipientPublic = Buffer.alloc(
      sodium.crypto_box_PUBLICKEYBYTES,
    );
    const nativeRecipientPrivate = Buffer.alloc(
      sodium.crypto_box_SECRETKEYBYTES,
    );
    sodium.crypto_box_seed_keypair(
      nativeSenderPublic,
      nativeSenderPrivate,
      Buffer.from(senderSeed),
    );
    sodium.crypto_box_seed_keypair(
      nativeRecipientPublic,
      nativeRecipientPrivate,
      Buffer.from(recipientSeed),
    );
    expect(nativeSenderPublic).toEqual(Buffer.from(wasmSender.publicKey));
    expect(nativeRecipientPrivate).toEqual(
      Buffer.from(wasmRecipient.privateKey),
    );
    const boxedPlaintext = domainMessage("eek-wrap", plaintext);
    const nativeBox = Buffer.alloc(
      boxedPlaintext.byteLength + sodium.crypto_box_MACBYTES,
    );
    sodium.crypto_box_easy(
      nativeBox,
      boxedPlaintext,
      Buffer.from(nonce),
      nativeRecipientPublic,
      nativeSenderPrivate,
    );
    expect(nativeBox).toEqual(
      Buffer.from(
        await ancV1BoxEncrypt(
          "eek-wrap",
          plaintext,
          nonce,
          wasmRecipient.publicKey,
          wasmSender.privateKey,
        ),
      ),
    );
  });

  it("matches the frozen Argon2id recovery derivation", async () => {
    const passphrase = "synthetic recovery parity phrase";
    const salt = pattern(0x66, 16);
    const opsLimit = 2;
    const memLimit = 67_108_864;
    const nativeKey = Buffer.alloc(32);
    sodium.crypto_pwhash(
      nativeKey,
      Buffer.from(passphrase),
      Buffer.from(salt),
      opsLimit,
      memLimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    expect(nativeKey).toEqual(
      Buffer.from(
        await ancV1DeriveRecoveryKey(passphrase, salt, {
          opsLimit,
          memLimit,
        }),
      ),
    );
  });

  it("decrypts the pinned secretstream chunk identically", async () => {
    const { materials } = await buildAncV1InteroperabilityVectors();
    const header = Buffer.from(ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX, "hex");
    const ciphertext = Buffer.from(
      ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX,
      "hex",
    );
    const state = Buffer.alloc(
      sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES,
    );
    sodium.crypto_secretstream_xchacha20poly1305_init_pull(
      state,
      header,
      Buffer.from(materials.chunkKey),
    );
    const plaintext = Buffer.alloc(
      ciphertext.byteLength -
        sodium.crypto_secretstream_xchacha20poly1305_ABYTES,
    );
    const tag = Buffer.alloc(1);
    sodium.crypto_secretstream_xchacha20poly1305_pull(
      state,
      plaintext,
      tag,
      ciphertext,
      domainAssociatedData("chunk", materials.chunkAad),
    );
    expect(tag[0]).toBe(sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
    expect(plaintext).toEqual(Buffer.from("synthetic chunk bytes"));
  });
});
