import {
  endpointRequestProofSchema,
  verifyEndpointRequestProof,
} from "@agent-native/core/e2ee";

import {
  privateVaultControlLogService,
  resolveActivePrivateVaultControlScope,
} from "./private-vault-control-log-runtime.js";
import { sqlPrivateVaultEndpointRequestNonceStore } from "./private-vault-endpoint-request-nonces.js";
import type { PrivateVaultEndpointPrincipal } from "./private-vault-jobs.js";

export class PrivateVaultBrokerAuthenticationError extends Error {
  constructor() {
    super("Private Vault broker authentication failed");
    this.name = "PrivateVaultBrokerAuthenticationError";
  }
}

export function decodePrivateVaultEndpointProofHeader(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) {
    throw new PrivateVaultBrokerAuthenticationError();
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.byteLength === 0 || bytes.toString("base64url") !== value) {
      throw new Error("invalid base64url");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const proof = endpointRequestProofSchema.parse(JSON.parse(text));
    if (JSON.stringify(proof) !== text) throw new Error("noncanonical proof");
    return proof;
  } catch {
    throw new PrivateVaultBrokerAuthenticationError();
  }
}

export async function authenticatePrivateVaultBrokerRequest(input: {
  proof: unknown;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultEndpointPrincipal> {
  const now = input.now ?? new Date();
  const resolved: { principal: PrivateVaultEndpointPrincipal | null } = {
    principal: null,
  };
  try {
    const authenticated = await verifyEndpointRequestProof({
      proof: input.proof,
      expectedMethod: input.method,
      expectedPath: input.path,
      body: input.body,
      now,
      resolveAuthorizedEndpoint: async ({ vaultId, endpointId }) => {
        const scope = await resolveActivePrivateVaultControlScope(vaultId);
        if (!scope) return null;
        const authority =
          await privateVaultControlLogService.resolveBrokerAuthorization(
            scope,
            endpointId,
          );
        if (!authority) return null;
        resolved.principal = { ...scope, endpointId };
        return {
          vaultId,
          endpointId,
          role: "broker" as const,
          state: "active" as const,
          signingPublicKey: Uint8Array.from(authority.signingPublicKey),
          authenticatedControlHead: {
            sequence: authority.authenticatedControlHead.sequence,
            hash: authority.authenticatedControlHead.hash,
            verifiedAt: now.toISOString(),
          },
        };
      },
      claimNonce: async ({ vaultId, endpointId, nonce, expiresAt }) => {
        if (
          !resolved.principal ||
          resolved.principal.vaultId !== vaultId ||
          resolved.principal.endpointId !== endpointId
        ) {
          return false;
        }
        return sqlPrivateVaultEndpointRequestNonceStore.claimAuthorizedControlRequest(
          { ...resolved.principal, nonce, expiresAt },
        );
      },
    });
    if (
      !resolved.principal ||
      authenticated.vaultId !== resolved.principal.vaultId ||
      authenticated.endpointId !== resolved.principal.endpointId
    ) {
      throw new Error("identity mismatch");
    }
    return resolved.principal;
  } catch {
    throw new PrivateVaultBrokerAuthenticationError();
  }
}
