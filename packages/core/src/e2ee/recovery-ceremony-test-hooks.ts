export type AncV1RecoveryDerivationTestHook = {
  afterSigningKeypair?: () => void;
  observeWipedArgon2Root?: (bytes: Uint8Array) => void;
  observeWipedPrivateKey?: (
    kind: "signing" | "key-agreement",
    bytes: Uint8Array,
  ) => void;
};

let recoveryDerivationTestHook: AncV1RecoveryDerivationTestHook | undefined;

export function getAncV1RecoveryDerivationTestHook():
  | AncV1RecoveryDerivationTestHook
  | undefined {
  return recoveryDerivationTestHook;
}

export function setAncV1RecoveryDerivationTestHook(
  hook: AncV1RecoveryDerivationTestHook | undefined,
): void {
  recoveryDerivationTestHook = hook;
}
