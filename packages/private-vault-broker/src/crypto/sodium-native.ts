import { createRequire } from "node:module";

import {
  AncV1CryptoError,
  E2EE_RECOVERY_KDF,
  e2eeDomainSeparationPrefix,
  type AncV1RecoveryEntropy,
  type AncV1VaultId,
  type E2EEDomainTag,
} from "@agent-native/core/e2ee";

import type {
  AncV1CryptoProvider,
  AncV1Keypair,
  AncV1SecretstreamCiphertext,
} from "./provider.js";

interface NativeSodium {
  crypto_sign_SEEDBYTES: number;
  crypto_sign_PUBLICKEYBYTES: number;
  crypto_sign_SECRETKEYBYTES: number;
  crypto_sign_BYTES: number;
  crypto_box_SEEDBYTES: number;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_SECRETKEYBYTES: number;
  crypto_box_NONCEBYTES: number;
  crypto_box_MACBYTES: number;
  crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  crypto_pwhash_ALG_ARGON2ID13: number;
  crypto_secretstream_xchacha20poly1305_KEYBYTES: number;
  crypto_secretstream_xchacha20poly1305_HEADERBYTES: number;
  crypto_secretstream_xchacha20poly1305_STATEBYTES: number;
  crypto_secretstream_xchacha20poly1305_ABYTES: number;
  crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
  crypto_generichash(output: Buffer, input: Buffer, key?: Buffer | null): void;
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
  crypto_sign_verify_detached(
    signature: Buffer,
    message: Buffer,
    publicKey: Buffer,
  ): boolean;
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
  crypto_box_open_easy(
    plaintext: Buffer,
    ciphertext: Buffer,
    nonce: Buffer,
    senderPublicKey: Buffer,
    recipientPrivateKey: Buffer,
  ): boolean;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext: Buffer,
    plaintext: Buffer,
    associatedData: Buffer,
    nsec: null,
    nonce: Buffer,
    key: Buffer,
  ): void;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    plaintext: Buffer,
    nsec: null,
    ciphertext: Buffer,
    associatedData: Buffer,
    nonce: Buffer,
    key: Buffer,
  ): boolean;
  crypto_pwhash(
    output: Buffer,
    password: Buffer,
    salt: Buffer,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
  ): void;
  crypto_secretstream_xchacha20poly1305_init_push(
    state: Buffer,
    header: Buffer,
    key: Buffer,
  ): void;
  crypto_secretstream_xchacha20poly1305_push(
    state: Buffer,
    ciphertext: Buffer,
    plaintext: Buffer,
    associatedData: Buffer,
    tag: number,
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
  ): boolean;
  randombytes_buf(output: Buffer): void;
  sodium_memcmp(left: Buffer, right: Buffer): boolean;
  sodium_memzero(value: Buffer): void;
}

const require = createRequire(import.meta.url);
const sodium = require("sodium-native") as NativeSodium;

function bytes(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function copy(value: Uint8Array): Uint8Array {
  // Native work buffers never cross the provider boundary. Callers receive an
  // independent allocation; each native source is wiped by its owning method.
  return Uint8Array.from(value);
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
const intrinsicUint8ArraySlice = Uint8Array.prototype.slice;

function wipe(...values: readonly Uint8Array[]): void {
  for (const value of values) {
    if (value.byteLength > 0) sodium.sodium_memzero(bytes(value));
  }
}

function concat(...parts: readonly Uint8Array[]): Buffer {
  return Buffer.concat(parts.map(bytes));
}

function assertLength(value: Uint8Array, length: number, name: string): void {
  let actualLength: number | undefined;
  try {
    actualLength = typedArrayByteLength.call(value) as number;
  } catch {
    // Proxies and impostors do not carry the required TypedArray internal slot.
  }
  if (actualLength !== length) {
    throw new AncV1CryptoError(`${name} must be exactly ${length} bytes`);
  }
}

function snapshotExactBytes(
  value: Uint8Array,
  length: number,
  name: string,
): Uint8Array {
  assertLength(value, length, name);
  return intrinsicUint8ArraySlice.call(value) as Uint8Array;
}

function assertCiphertextLength(
  value: Uint8Array,
  overhead: number,
  name: string,
): void {
  if (!(value instanceof Uint8Array) || value.byteLength < overhead) {
    throw new AncV1CryptoError(`${name} has an invalid length`);
  }
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

export class SodiumNativeAncV1CryptoProvider implements AncV1CryptoProvider {
  hash(tag: E2EEDomainTag, payload: Uint8Array): Uint8Array {
    const output = Buffer.alloc(32);
    const message = domainMessage(tag, payload);
    try {
      sodium.crypto_generichash(output, message, null);
      return copy(output);
    } finally {
      wipe(message, output);
    }
  }

  signingKeypairFromSeed(seed: Uint8Array): AncV1Keypair {
    assertLength(seed, sodium.crypto_sign_SEEDBYTES, "Signing seed");
    const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const privateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    try {
      sodium.crypto_sign_seed_keypair(publicKey, privateKey, bytes(seed));
      return { publicKey: copy(publicKey), privateKey: copy(privateKey) };
    } finally {
      wipe(publicKey, privateKey);
    }
  }

  boxKeypairFromSeed(seed: Uint8Array): AncV1Keypair {
    assertLength(seed, sodium.crypto_box_SEEDBYTES, "Box seed");
    const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
    const privateKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
    try {
      sodium.crypto_box_seed_keypair(publicKey, privateKey, bytes(seed));
      return { publicKey: copy(publicKey), privateKey: copy(privateKey) };
    } finally {
      wipe(publicKey, privateKey);
    }
  }

  signDetached(
    tag: E2EEDomainTag,
    payload: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array {
    assertLength(
      privateKey,
      sodium.crypto_sign_SECRETKEYBYTES,
      "Signing private key",
    );
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
    const message = domainMessage(tag, payload);
    try {
      sodium.crypto_sign_detached(signature, message, bytes(privateKey));
      return copy(signature);
    } finally {
      wipe(message, signature);
    }
  }

  verifyDetached(
    tag: E2EEDomainTag,
    payload: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ): boolean {
    assertLength(signature, sodium.crypto_sign_BYTES, "Signature");
    assertLength(
      publicKey,
      sodium.crypto_sign_PUBLICKEYBYTES,
      "Signing public key",
    );
    const message = domainMessage(tag, payload);
    try {
      return sodium.crypto_sign_verify_detached(
        bytes(signature),
        message,
        bytes(publicKey),
      );
    } finally {
      wipe(message);
    }
  }

  aeadEncrypt(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    assertLength(
      nonce,
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
      "AEAD nonce",
    );
    assertLength(
      key,
      sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
      "AEAD key",
    );
    const ciphertext = Buffer.alloc(
      plaintext.byteLength + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
    );
    const domainAad = domainAssociatedData(tag, associatedData);
    try {
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        ciphertext,
        bytes(plaintext),
        domainAad,
        null,
        bytes(nonce),
        bytes(key),
      );
      return copy(ciphertext);
    } finally {
      wipe(domainAad, ciphertext);
    }
  }

  aeadDecrypt(
    tag: E2EEDomainTag,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    assertLength(
      nonce,
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
      "AEAD nonce",
    );
    assertLength(
      key,
      sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
      "AEAD key",
    );
    assertCiphertextLength(
      ciphertext,
      sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
      "AEAD ciphertext",
    );
    const plaintext = Buffer.alloc(
      ciphertext.byteLength - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES,
    );
    const domainAad = domainAssociatedData(tag, associatedData);
    try {
      const authenticated = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        plaintext,
        null,
        bytes(ciphertext),
        domainAad,
        bytes(nonce),
        bytes(key),
      );
      if (!authenticated) throw new Error("unauthenticated");
      return copy(plaintext);
    } catch {
      throw new AncV1CryptoError("AEAD authentication failed");
    } finally {
      wipe(domainAad, plaintext);
    }
  }

  boxEncrypt(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    nonce: Uint8Array,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
  ): Uint8Array {
    assertLength(nonce, sodium.crypto_box_NONCEBYTES, "Box nonce");
    assertLength(
      recipientPublicKey,
      sodium.crypto_box_PUBLICKEYBYTES,
      "Recipient public key",
    );
    assertLength(
      senderPrivateKey,
      sodium.crypto_box_SECRETKEYBYTES,
      "Sender private key",
    );
    const message = domainMessage(tag, plaintext);
    const ciphertext = Buffer.alloc(
      message.byteLength + sodium.crypto_box_MACBYTES,
    );
    try {
      sodium.crypto_box_easy(
        ciphertext,
        message,
        bytes(nonce),
        bytes(recipientPublicKey),
        bytes(senderPrivateKey),
      );
      return copy(ciphertext);
    } finally {
      wipe(message, ciphertext);
    }
  }

  boxDecrypt(
    tag: E2EEDomainTag,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ): Uint8Array {
    assertLength(nonce, sodium.crypto_box_NONCEBYTES, "Box nonce");
    assertLength(
      senderPublicKey,
      sodium.crypto_box_PUBLICKEYBYTES,
      "Sender public key",
    );
    assertLength(
      recipientPrivateKey,
      sodium.crypto_box_SECRETKEYBYTES,
      "Recipient private key",
    );
    assertCiphertextLength(
      ciphertext,
      sodium.crypto_box_MACBYTES,
      "Box ciphertext",
    );
    const message = Buffer.alloc(
      ciphertext.byteLength - sodium.crypto_box_MACBYTES,
    );
    const prefix = bytes(e2eeDomainSeparationPrefix(tag));
    try {
      const authenticated = sodium.crypto_box_open_easy(
        message,
        bytes(ciphertext),
        bytes(nonce),
        bytes(senderPublicKey),
        bytes(recipientPrivateKey),
      );
      if (!authenticated) throw new Error("unauthenticated");
      if (
        message.byteLength < prefix.byteLength ||
        !sodium.sodium_memcmp(message.subarray(0, prefix.byteLength), prefix)
      ) {
        throw new AncV1CryptoError("Box domain separation failed");
      }
      return copy(message.subarray(prefix.byteLength));
    } catch (error) {
      if (error instanceof AncV1CryptoError) throw error;
      throw new AncV1CryptoError("Box authentication failed");
    } finally {
      wipe(prefix, message);
    }
  }

  deriveRecoveryRoot(
    recoveryEntropy: AncV1RecoveryEntropy,
    vaultId: AncV1VaultId,
  ): Uint8Array {
    const password = snapshotExactBytes(
      recoveryEntropy,
      E2EE_RECOVERY_KDF.inputBytes,
      "BIP39 recovery entropy",
    );
    let salt: Uint8Array | undefined;
    const output = Buffer.alloc(E2EE_RECOVERY_KDF.outputBytes);
    try {
      salt = snapshotExactBytes(
        vaultId,
        E2EE_RECOVERY_KDF.saltBytes,
        "Vault ID",
      );
      sodium.crypto_pwhash(
        output,
        bytes(password),
        bytes(salt),
        E2EE_RECOVERY_KDF.opsLimit,
        E2EE_RECOVERY_KDF.memLimitBytes,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      );
      return copy(output);
    } finally {
      wipe(password, ...(salt ? [salt] : []), output);
    }
  }

  secretstreamEncryptOne(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
    key: Uint8Array,
  ): AncV1SecretstreamCiphertext {
    assertLength(
      key,
      sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
      "Secretstream key",
    );
    const state = Buffer.alloc(
      sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES,
    );
    const header = Buffer.alloc(
      sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES,
    );
    const ciphertext = Buffer.alloc(
      plaintext.byteLength +
        sodium.crypto_secretstream_xchacha20poly1305_ABYTES,
    );
    const domainAad = domainAssociatedData(tag, associatedData);
    try {
      sodium.crypto_secretstream_xchacha20poly1305_init_push(
        state,
        header,
        bytes(key),
      );
      sodium.crypto_secretstream_xchacha20poly1305_push(
        state,
        ciphertext,
        bytes(plaintext),
        domainAad,
        sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
      );
      return { header: copy(header), ciphertext: copy(ciphertext) };
    } finally {
      wipe(state, domainAad, header, ciphertext);
    }
  }

  secretstreamDecryptOne(
    tag: E2EEDomainTag,
    header: Uint8Array,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    assertLength(
      header,
      sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES,
      "Secretstream header",
    );
    assertLength(
      key,
      sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
      "Secretstream key",
    );
    assertCiphertextLength(
      ciphertext,
      sodium.crypto_secretstream_xchacha20poly1305_ABYTES,
      "Secretstream ciphertext",
    );
    const state = Buffer.alloc(
      sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES,
    );
    const plaintext = Buffer.alloc(
      ciphertext.byteLength -
        sodium.crypto_secretstream_xchacha20poly1305_ABYTES,
    );
    const finalTag = Buffer.alloc(1);
    const domainAad = domainAssociatedData(tag, associatedData);
    try {
      sodium.crypto_secretstream_xchacha20poly1305_init_pull(
        state,
        bytes(header),
        bytes(key),
      );
      const authenticated = sodium.crypto_secretstream_xchacha20poly1305_pull(
        state,
        plaintext,
        finalTag,
        bytes(ciphertext),
        domainAad,
      );
      if (
        !authenticated ||
        finalTag[0] !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
      ) {
        throw new Error("unauthenticated");
      }
      return copy(plaintext);
    } catch {
      throw new AncV1CryptoError("Secretstream authentication failed");
    } finally {
      wipe(state, domainAad, plaintext, finalTag);
    }
  }

  randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new AncV1CryptoError(
        "Random byte length must be a positive integer",
      );
    }
    const output = Buffer.alloc(length);
    try {
      sodium.randombytes_buf(output);
      return copy(output);
    } finally {
      wipe(output);
    }
  }

  zeroize(value: Uint8Array): void {
    sodium.sodium_memzero(bytes(value));
  }
}

export const sodiumNativeAncV1 = new SodiumNativeAncV1CryptoProvider();
