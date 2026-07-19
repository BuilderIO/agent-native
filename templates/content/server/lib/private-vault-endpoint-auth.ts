import {
  ancV1HexToBytes,
  assertFreshControlLogHead,
  controlLogStateSchema,
  verifyEndpointRequestProofWithIdentity,
} from "@agent-native/core/e2ee";

import { decodePrivateVaultEndpointProofHeader } from "./private-vault-broker-auth.js";
import {
  privateVaultControlLogService,
  resolveActivePrivateVaultControlScope,
} from "./private-vault-control-log-runtime.js";
import { sqlPrivateVaultEndpointRequestNonceStore } from "./private-vault-endpoint-request-nonces.js";
import type { PrivateVaultMigrationEvidencePrincipal } from "./private-vault-migration-evidence.js";

export class PrivateVaultEndpointAuthenticationError extends Error {
  constructor() {
    super("Private Vault endpoint authentication failed");
    this.name = "PrivateVaultEndpointAuthenticationError";
  }
}

export { decodePrivateVaultEndpointProofHeader };

export async function authenticatePrivateVaultAttendedEndpoint(input: {
  proof: unknown;
  method: "POST";
  path: string;
  body: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultMigrationEvidencePrincipal> {
  const now = input.now ?? new Date();
  const resolvedPrincipal: {
    current: PrivateVaultMigrationEvidencePrincipal | null;
  } = { current: null };
  try {
    const authenticated = await verifyEndpointRequestProofWithIdentity({
      proof: input.proof,
      expectedMethod: input.method,
      expectedPath: input.path,
      body: input.body,
      now,
      resolveAuthorizedEndpoint: async ({ vaultId, endpointId }) => {
        const scope = await resolveActivePrivateVaultControlScope(vaultId);
        if (!scope) return null;
        const rawState =
          await privateVaultControlLogService.loadVerifiedState(scope);
        if (!rawState) return null;
        const state = assertFreshControlLogHead(
          controlLogStateSchema.parse(rawState),
          now,
        );
        const member = state.activeMembers.find(
          (candidate) => candidate.endpointId === endpointId,
        );
        if (!member || member.role !== "endpoint" || member.unattended)
          return null;
        resolvedPrincipal.current = { ...scope, endpointId };
        return {
          vaultId,
          endpointId,
          state: "active" as const,
          signingPublicKey: Uint8Array.from(
            ancV1HexToBytes(member.signingPublicKey),
          ),
        };
      },
      claimNonce: async ({ vaultId, endpointId, nonce, expiresAt }) => {
        if (
          !resolvedPrincipal.current ||
          resolvedPrincipal.current.vaultId !== vaultId ||
          resolvedPrincipal.current.endpointId !== endpointId
        )
          return false;
        return sqlPrivateVaultEndpointRequestNonceStore.claimAuthorizedControlRequest(
          { ...resolvedPrincipal.current, nonce, expiresAt },
        );
      },
    });
    const principal = resolvedPrincipal.current;
    if (
      !principal ||
      authenticated.vaultId !== principal.vaultId ||
      authenticated.endpointId !== principal.endpointId
    )
      throw new Error();
    return principal;
  } catch {
    throw new PrivateVaultEndpointAuthenticationError();
  }
}
