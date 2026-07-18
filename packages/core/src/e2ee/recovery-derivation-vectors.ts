/**
 * Public, source-anchored anc/v1 recovery derivation vector.
 *
 * Recovery entropy and the Argon2 root are deliberately absent. A test or
 * native implementation reconstructs the obviously synthetic entropy recipe
 * at runtime and compares one-way secret commitments plus the derived public
 * recovery identity and public keys. No private material is stored here.
 */
export const ANC_V1_RECOVERY_DERIVATION_VECTOR = Object.freeze({
  id: "anc-v1-synthetic-counter-recovery-derivation",
  recoveryEntropyRecipe: "byte[i] = i for i in 0..31",
  recoveryEntropyCommitmentHex:
    "adfb669ca3e6a8b5fc796bb326a27cf3e86c5bf2f733a9d85679f0e375e2652b",
  mnemonicEncoding: "bip39-english-24-word-nfkd",
  mnemonicCommitmentHex:
    "6354f858df85c21f2e28cef88a3c0c47ef386a9f216613240938d056ca9a1a83",
  vaultIdHex: "000102030405060708090a0b0c0d0e0f",
  recoveryGeneration: 1,
  recoveryRootCommitmentHex:
    "77688ed409de8bea839eaffd177714784b5900a9fccbdc5b4be2a1a8b66171bc",
  recoveryIdHex: "dae800f05777729e6f0f986851e371a2",
  recoverySigningPublicKeyHex:
    "79b6f418f2503137efe265070a92aa4773cb75e4cb97467470c49745fc39a592",
  recoveryKeyAgreementPublicKeyHex:
    "df74bae8d760604be7a24833482eb4b2e28bb3434d0ad227bf70f139740e7578",
  commitmentDomain: "anc/v1/recovery\\0 || value",
});
