import { createHash } from "node:crypto";

export function privateVaultControlEvidenceHash(
  kind: "genesis" | "recovery",
  evidence: Uint8Array,
): string {
  return createHash("sha256")
    .update("anc/v1/content-control-evidence\0")
    .update(kind)
    .update("\0")
    .update(evidence)
    .digest("hex");
}

export function privateVaultRecoveryNonceDigest(nonce: Uint8Array): string {
  return createHash("sha256")
    .update("anc/v1/content-recovery-confirmation-nonce\0")
    .update(nonce)
    .digest("hex");
}
