import type {
  AncV1RecoveryEntropy,
  AncV1VaultId,
  E2EEDomainTag,
} from "@agent-native/core/e2ee";

export interface AncV1Keypair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export interface AncV1SecretstreamCiphertext {
  readonly header: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** Native cryptographic operations implementing the frozen anc/v1 suite. */
export interface AncV1CryptoProvider {
  hash(tag: E2EEDomainTag, payload: Uint8Array): Uint8Array;
  signingKeypairFromSeed(seed: Uint8Array): AncV1Keypair;
  boxKeypairFromSeed(seed: Uint8Array): AncV1Keypair;
  signDetached(
    tag: E2EEDomainTag,
    payload: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  verifyDetached(
    tag: E2EEDomainTag,
    payload: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ): boolean;
  aeadEncrypt(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  aeadDecrypt(
    tag: E2EEDomainTag,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  boxEncrypt(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    nonce: Uint8Array,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
  ): Uint8Array;
  boxDecrypt(
    tag: E2EEDomainTag,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    senderPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ): Uint8Array;
  deriveRecoveryRoot(
    recoveryEntropy: AncV1RecoveryEntropy,
    vaultId: AncV1VaultId,
  ): Uint8Array;
  secretstreamEncryptOne(
    tag: E2EEDomainTag,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
    key: Uint8Array,
  ): AncV1SecretstreamCiphertext;
  secretstreamDecryptOne(
    tag: E2EEDomainTag,
    header: Uint8Array,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  randomBytes(length: number): Uint8Array;
  zeroize(value: Uint8Array): void;
}
