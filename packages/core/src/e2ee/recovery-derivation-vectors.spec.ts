import { describe, expect, it } from "vitest";

import {
  ancV1DeriveRecoveryRoot,
  ancV1Hash,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1VaultId,
} from "./portable-crypto.js";
import {
  type AncV1RecoveryAuthority,
  deriveAncV1RecoveryAuthority,
  deriveAncV1RecoveryAuthorityFromEntropy,
} from "./recovery-ceremony-codecs.js";
import { setAncV1RecoveryDerivationTestHook } from "./recovery-ceremony-test-hooks.js";
import { ANC_V1_RECOVERY_DERIVATION_VECTOR as VECTOR } from "./recovery-derivation-vectors.js";

function syntheticCounterBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index);
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function wipeAuthority(authority: AncV1RecoveryAuthority): void {
  authority.recoveryId.fill(0);
  authority.signingPublicKey.fill(0);
  authority.signingPrivateKey.fill(0);
  authority.keyAgreementPublicKey.fill(0);
  authority.keyAgreementPrivateKey.fill(0);
}

function expectVectorAuthority(authority: AncV1RecoveryAuthority): void {
  expect(authority.recoveryGeneration).toBe(VECTOR.recoveryGeneration);
  expect(hex(authority.recoveryId)).toBe(VECTOR.recoveryIdHex);
  expect(hex(authority.signingPublicKey)).toBe(
    VECTOR.recoverySigningPublicKeyHex,
  );
  expect(hex(authority.keyAgreementPublicKey)).toBe(
    VECTOR.recoveryKeyAgreementPublicKeyHex,
  );
}

describe("anc/v1 canonical recovery derivation", () => {
  it("matches the source-anchored one-way commitments", async () => {
    const rawEntropy = syntheticCounterBytes(32);
    const rawVaultId = syntheticCounterBytes(16);
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(rawEntropy);
    const vaultId = ancV1VaultId(rawVaultId);

    expect(hex(await ancV1Hash("recovery", recoveryEntropy))).toBe(
      VECTOR.recoveryEntropyCommitmentHex,
    );
    const root = await ancV1DeriveRecoveryRoot({ recoveryEntropy, vaultId });
    expect(hex(await ancV1Hash("recovery", root))).toBe(
      VECTOR.recoveryRootCommitmentHex,
    );
    const authority = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
    });
    expectVectorAuthority(authority);

    wipeAuthority(authority);
    root.fill(0);
    recoveryEntropy.fill(0);
    vaultId.fill(0);
    rawEntropy.fill(0);
    rawVaultId.fill(0);
  });

  it("equals the low-level root-to-authority composition", async () => {
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      syntheticCounterBytes(32),
    );
    const vaultId = ancV1VaultId(syntheticCounterBytes(16));
    const root = await ancV1DeriveRecoveryRoot({ recoveryEntropy, vaultId });
    const lowLevel = await deriveAncV1RecoveryAuthority({
      vaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
      argon2Root: root,
    });
    const normative = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
    });

    expect(normative).toEqual(lowLevel);
    wipeAuthority(lowLevel);
    wipeAuthority(normative);
    root.fill(0);
    recoveryEntropy.fill(0);
    vaultId.fill(0);
  });

  it("separates recovery generations and binds the exact vault ID", async () => {
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      syntheticCounterBytes(32),
    );
    const canonicalVaultId = ancV1VaultId(syntheticCounterBytes(16));
    const differentVaultBytes = syntheticCounterBytes(16);
    differentVaultBytes[15] ^= 0x01;
    const differentVaultId = ancV1VaultId(differentVaultBytes);

    const canonical = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId: canonicalVaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
    });
    const nextGeneration = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId: canonicalVaultId,
      recoveryGeneration: VECTOR.recoveryGeneration + 1,
    });
    const differentVault = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId: differentVaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
    });
    expect(nextGeneration.recoveryId).not.toEqual(canonical.recoveryId);
    expect(nextGeneration.signingPublicKey).not.toEqual(
      canonical.signingPublicKey,
    );
    expect(differentVault.recoveryId).not.toEqual(canonical.recoveryId);

    wipeAuthority(canonical);
    wipeAuthority(nextGeneration);
    wipeAuthority(differentVault);
    recoveryEntropy.fill(0);
    canonicalVaultId.fill(0);
    differentVaultId.fill(0);
    differentVaultBytes.fill(0);
  });

  it("snapshots caller inputs before asynchronous derivation", async () => {
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      syntheticCounterBytes(32),
    );
    const vaultId = ancV1VaultId(syntheticCounterBytes(16));
    const derivation = deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy,
      vaultId,
      recoveryGeneration: VECTOR.recoveryGeneration,
    });

    recoveryEntropy.fill(0xff);
    vaultId.fill(0xff);

    const authority = await derivation;
    expectVectorAuthority(authority);
    wipeAuthority(authority);
    recoveryEntropy.fill(0);
    vaultId.fill(0);
  });

  it("snapshots high-level getter inputs before later getters can substitute", async () => {
    const recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(
      syntheticCounterBytes(32),
    );
    const vaultId = ancV1VaultId(syntheticCounterBytes(16));
    let entropyReads = 0;
    let vaultReads = 0;
    let generationReads = 0;
    const input = {
      get recoveryEntropy() {
        entropyReads += 1;
        return recoveryEntropy;
      },
      get vaultId() {
        vaultReads += 1;
        recoveryEntropy.fill(0xff);
        return vaultId;
      },
      get recoveryGeneration() {
        generationReads += 1;
        vaultId.fill(0xff);
        return VECTOR.recoveryGeneration;
      },
    };
    const authority = await deriveAncV1RecoveryAuthorityFromEntropy(input);
    expectVectorAuthority(authority);
    expect({ entropyReads, vaultReads, generationReads }).toEqual({
      entropyReads: 1,
      vaultReads: 1,
      generationReads: 1,
    });
    wipeAuthority(authority);
    recoveryEntropy.fill(0);
    vaultId.fill(0);
  });

  it("wipes the high-level helper's owned Argon2 root", async () => {
    let observed = false;
    try {
      setAncV1RecoveryDerivationTestHook({
        observeWipedArgon2Root: (root) => {
          expect(root.every((byte) => byte === 0)).toBe(true);
          observed = true;
        },
      });
      const authority = await deriveAncV1RecoveryAuthorityFromEntropy({
        recoveryEntropy: ancV1RecoveryEntropyFromBip39Bytes(
          syntheticCounterBytes(32),
        ),
        vaultId: ancV1VaultId(syntheticCounterBytes(16)),
        recoveryGeneration: VECTOR.recoveryGeneration,
      });
      wipeAuthority(authority);
    } finally {
      setAncV1RecoveryDerivationTestHook(undefined);
    }
    expect(observed).toBe(true);
  });
});
