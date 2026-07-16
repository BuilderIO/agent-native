import sodium from "libsodium-wrappers-sumo";

import type { E2EEDomainTag } from "./suite.js";
import { e2eeDomainSeparationPrefix } from "./suite.js";

export class AncV1CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1CryptoError";
  }
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function ancV1PackNonceCiphertext(
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  if (nonce.byteLength === 0 || ciphertext.byteLength === 0) {
    throw new AncV1CryptoError("Nonce and ciphertext must be non-empty");
  }
  return concatBytes(nonce, ciphertext);
}

export function ancV1UnpackNonceCiphertext(
  packed: Uint8Array,
  nonceBytes = 24,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (
    !Number.isSafeInteger(nonceBytes) ||
    nonceBytes <= 0 ||
    packed.byteLength <= nonceBytes
  ) {
    throw new AncV1CryptoError("Packed nonce/ciphertext has an invalid length");
  }
  return {
    nonce: packed.slice(0, nonceBytes),
    ciphertext: packed.slice(nonceBytes),
  };
}

function assertLength(value: Uint8Array, length: number, name: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    throw new AncV1CryptoError(`${name} must be exactly ${length} bytes`);
  }
}

function domainMessage(tag: E2EEDomainTag, payload: Uint8Array): Uint8Array {
  return concatBytes(e2eeDomainSeparationPrefix(tag), payload);
}

function domainAssociatedData(
  tag: E2EEDomainTag,
  associatedData: Uint8Array,
): Uint8Array {
  return concatBytes(e2eeDomainSeparationPrefix(tag), associatedData);
}

async function ready(): Promise<void> {
  await sodium.ready;
}

export async function ancV1Hash(
  tag: E2EEDomainTag,
  payload: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  return sodium.crypto_generichash(32, domainMessage(tag, payload), null);
}

export async function ancV1SigningKeypairFromSeed(seed: Uint8Array): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  await ready();
  assertLength(seed, sodium.crypto_sign_SEEDBYTES, "Signing seed");
  const pair = sodium.crypto_sign_seed_keypair(seed);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function ancV1BoxKeypairFromSeed(seed: Uint8Array): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  await ready();
  assertLength(seed, sodium.crypto_box_SEEDBYTES, "Box seed");
  const pair = sodium.crypto_box_seed_keypair(seed);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function ancV1SignDetached(
  tag: E2EEDomainTag,
  payload: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  assertLength(
    privateKey,
    sodium.crypto_sign_SECRETKEYBYTES,
    "Signing private key",
  );
  return sodium.crypto_sign_detached(domainMessage(tag, payload), privateKey);
}

export async function ancV1VerifyDetached(
  tag: E2EEDomainTag,
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  await ready();
  assertLength(signature, sodium.crypto_sign_BYTES, "Signature");
  assertLength(
    publicKey,
    sodium.crypto_sign_PUBLICKEYBYTES,
    "Signing public key",
  );
  return sodium.crypto_sign_verify_detached(
    signature,
    domainMessage(tag, payload),
    publicKey,
  );
}

export async function ancV1AeadEncrypt(
  tag: E2EEDomainTag,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  await ready();
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
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    domainAssociatedData(tag, associatedData),
    null,
    nonce,
    key,
  );
}

export async function ancV1AeadDecrypt(
  tag: E2EEDomainTag,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  await ready();
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
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      domainAssociatedData(tag, associatedData),
      nonce,
      key,
    );
  } catch {
    throw new AncV1CryptoError("AEAD authentication failed");
  }
}

export async function ancV1BoxEncrypt(
  tag: E2EEDomainTag,
  plaintext: Uint8Array,
  nonce: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  await ready();
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
  return sodium.crypto_box_easy(
    domainMessage(tag, plaintext),
    nonce,
    recipientPublicKey,
    senderPrivateKey,
  );
}

export async function ancV1BoxDecrypt(
  tag: E2EEDomainTag,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  await ready();
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
  try {
    const message = sodium.crypto_box_open_easy(
      ciphertext,
      nonce,
      senderPublicKey,
      recipientPrivateKey,
    );
    const prefix = e2eeDomainSeparationPrefix(tag);
    if (
      message.byteLength < prefix.byteLength ||
      !sodium.memcmp(message.subarray(0, prefix.byteLength), prefix)
    ) {
      throw new AncV1CryptoError("Box domain separation failed");
    }
    return message.subarray(prefix.byteLength);
  } catch (error) {
    if (error instanceof AncV1CryptoError) throw error;
    throw new AncV1CryptoError("Box authentication failed");
  }
}

export async function ancV1DeriveRecoveryKey(
  passphrase: string,
  salt: Uint8Array,
  options?: { opsLimit?: number; memLimit?: number },
): Promise<Uint8Array> {
  await ready();
  assertLength(salt, sodium.crypto_pwhash_SALTBYTES, "Recovery salt");
  return sodium.crypto_pwhash(
    32,
    passphrase,
    salt,
    options?.opsLimit ?? sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    options?.memLimit ?? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function ancV1SecretstreamEncryptOne(
  tag: E2EEDomainTag,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
  key: Uint8Array,
): Promise<{ header: Uint8Array; ciphertext: Uint8Array }> {
  await ready();
  assertLength(
    key,
    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
    "Secretstream key",
  );
  const { state, header } =
    sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
    state,
    plaintext,
    domainAssociatedData(tag, associatedData),
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );
  return { header, ciphertext };
}

export async function ancV1SecretstreamDecryptOne(
  tag: E2EEDomainTag,
  header: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  await ready();
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
  try {
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
      header,
      key,
    );
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
      state,
      ciphertext,
      domainAssociatedData(tag, associatedData),
    );
    if (
      !result ||
      result.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
    ) {
      throw new AncV1CryptoError("Secretstream final authentication failed");
    }
    return result.message;
  } catch (error) {
    if (error instanceof AncV1CryptoError) throw error;
    throw new AncV1CryptoError("Secretstream authentication failed");
  }
}
