import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getSecretEncryptionKey } from "../secrets/crypto.js";
import { PrivateBlobError } from "./errors.js";

export interface BlobEncryptionParams {
  iv: string;
  tag: string;
}

export interface EncryptedBlob extends BlobEncryptionParams {
  ciphertext: Uint8Array;
}

/** Encrypts blob bytes with AES-256-GCM under the app's secret key. */
export function encryptBlobBytes(data: Uint8Array): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(data)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64url"),
    ciphertext: new Uint8Array(ciphertext),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptBlobBytes(
  params: BlobEncryptionParams,
  ciphertext: Uint8Array,
): Uint8Array {
  const key = getSecretEncryptionKey();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(params.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(params.tag, "base64url"));
    return new Uint8Array(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext)),
        decipher.final(),
      ]),
    );
  } catch (error) {
    throw new PrivateBlobError(
      "Private blob bytes could not be decrypted",
      "corrupt",
      { cause: error },
    );
  }
}
