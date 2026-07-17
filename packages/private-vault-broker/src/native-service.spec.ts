import { readFile } from "node:fs/promises";

import {
  encodeAncV1Canonical,
  encodeEndpointRequestUnsignedProof,
  encodeSignedControlLogEntry,
  type AncV1CanonicalValue,
} from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import {
  parsePrivateVaultNativeServiceRequest,
  parsePrivateVaultNativeServiceResult,
  PRIVATE_VAULT_NATIVE_SERVICE_LIMITS,
  PrivateVaultNativeServiceContractError,
} from "./native-service.js";
import { BROKER_JOB_PATHS } from "./transport.js";

const BASE = Object.freeze({ version: 1, suite: "anc/v1" });
const vaultId = "vault-12345678";
const endpointId = "endpoint-12345678";
const objectId = "object-12345678";
const jobId = "job-12345678";

function unsignedEndpointProof(
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    path?: string;
  } = {},
): Uint8Array {
  return encodeEndpointRequestUnsignedProof({
    version: 1,
    suite: "anc/v1",
    type: "endpoint_request",
    vaultId,
    endpointId,
    method: options.method ?? "POST",
    path: options.path ?? "/api/private-vault/jobs/broker/claim",
    bodyHash: "11".repeat(32),
    issuedAt: "2026-07-16T12:00:00.000Z",
    nonce: "22".repeat(16),
  });
}

function removalAuthorization(forVaultId = vaultId): Uint8Array {
  return encodeSignedControlLogEntry({
    suite: "anc/v1",
    type: "log-entry",
    vaultId: forVaultId,
    createdAt: "2026-07-16T12:00:00.000Z",
    envelopeId: "envelope-12345678",
    sequence: 7,
    previousHash: "11".repeat(32),
    signerEndpointId: "endpoint-signer-12345678",
    signature: "22".repeat(64),
    innerEnvelope: {
      suite: "anc/v1",
      type: "membership_commit",
      vaultId: forVaultId,
      ceremonyId: "ceremony-12345678",
      ceremonyKind: "remove_device",
      epoch: 3,
      previousMembershipHash: "33".repeat(32),
      activeMembers: [
        {
          endpointId: "endpoint-active-12345678",
          role: "endpoint",
          unattended: false,
          signingPublicKey: "44".repeat(32),
          keyAgreementPublicKey: "55".repeat(32),
          enrollmentRef: "enrollment-12345678",
        },
      ],
      removedEndpointIds: ["endpoint-removed-12345678"],
      rotationCompleted: true,
      outstandingJobsResolved: true,
      recoverySnapshotHash: null,
      recoveryAuthorizationHash: null,
    },
  });
}

function contractError(
  call: () => unknown,
  code: "invalid_request" | "invalid_result",
) {
  try {
    call();
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateVaultNativeServiceContractError);
    expect(error).toMatchObject({
      code,
      message: "Private vault native service contract rejected data",
    });
    expect(String(error)).not.toContain(vaultId);
    expect(String(error)).not.toContain(endpointId);
  }
}

describe("private-vault native service contract", () => {
  it("accepts only the fixed semantic request operations", () => {
    const requests = [
      { ...BASE, operation: "health" },
      { ...BASE, operation: "enrollVault", vaultId, endpointId },
      {
        ...BASE,
        operation: "importRecovery",
        vaultId,
        endpointId,
        recoveryEnvelope: new Uint8Array([1]),
        recoveryPassphrase: new Uint8Array([2]),
      },
      {
        ...BASE,
        operation: "removeVault",
        vaultId,
        removalAuthorization: removalAuthorization(),
      },
      { ...BASE, operation: "unlock", vaultId },
      { ...BASE, operation: "lock" },
      {
        ...BASE,
        operation: "sealContentObject",
        vaultId,
        objectId,
        revision: 1,
        contentType: "text/markdown",
        plaintext: new Uint8Array(),
      },
      {
        ...BASE,
        operation: "openContentObject",
        vaultId,
        objectId,
        revision: 1,
        objectEnvelope: new Uint8Array([3]),
      },
      {
        ...BASE,
        operation: "openHostedJob",
        vaultId,
        endpointId,
        jobId,
        jobEnvelope: new Uint8Array([4]),
      },
      {
        ...BASE,
        operation: "sealHostedResult",
        vaultId,
        endpointId,
        jobId,
        jobHash: "33".repeat(32),
        state: "completed",
        resultPayload: new Uint8Array(),
      },
      {
        ...BASE,
        operation: "signEndpointRequest",
        unsignedProof: unsignedEndpointProof(),
      },
      {
        ...BASE,
        operation: "exportRecoveryEnvelope",
        vaultId,
        recoveryPassphrase: new Uint8Array([5]),
      },
    ];

    expect(
      requests.map(
        (request) => parsePrivateVaultNativeServiceRequest(request).operation,
      ),
    ).toEqual(requests.map((request) => request.operation));
    contractError(
      () =>
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "decrypt",
          ciphertext: new Uint8Array([1]),
        }),
      "invalid_request",
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "signEndpointRequest",
          unsignedProof: unsignedEndpointProof({ method: "GET" }),
        }),
      "invalid_request",
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "signEndpointRequest",
          unsignedProof: unsignedEndpointProof({
            path: "/api/private-vault/jobs/broker/not-a-route",
          }),
        }),
      "invalid_request",
    );
  });

  it("accepts only the matching fixed semantic results", () => {
    const results = [
      {
        ...BASE,
        operation: "health",
        state: "uninitialized",
        available: true,
        ready: false,
        unlocked: false,
      },
      {
        ...BASE,
        operation: "enrollVault",
        endpointEnvelope: new Uint8Array([1]),
      },
      {
        ...BASE,
        operation: "importRecovery",
        endpointEnvelope: new Uint8Array([2]),
      },
      { ...BASE, operation: "removeVault", removed: true },
      { ...BASE, operation: "unlock", state: "unlocked" },
      { ...BASE, operation: "lock", state: "locked" },
      {
        ...BASE,
        operation: "sealContentObject",
        objectEnvelope: new Uint8Array([3]),
      },
      {
        ...BASE,
        operation: "openContentObject",
        contentType: "text/plain",
        plaintext: new Uint8Array(),
      },
      {
        ...BASE,
        operation: "openHostedJob",
        jobPayload: new Uint8Array(),
      },
      {
        ...BASE,
        operation: "sealHostedResult",
        resultEnvelope: new Uint8Array([4]),
      },
      {
        ...BASE,
        operation: "signEndpointRequest",
        signature: new Uint8Array(64),
      },
      {
        ...BASE,
        operation: "exportRecoveryEnvelope",
        recoveryEnvelope: new Uint8Array([5]),
      },
    ];
    expect(
      results.map(
        (result) => parsePrivateVaultNativeServiceResult(result).operation,
      ),
    ).toEqual(results.map((result) => result.operation));

    contractError(
      () =>
        parsePrivateVaultNativeServiceResult({
          ...BASE,
          operation: "lock",
          state: "unlocked",
        }),
      "invalid_result",
    );
  });

  it("rejects unknown fields, identity-bearing health, wrong versions, and bounds", () => {
    const invalid = [
      { ...BASE, operation: "health", vaultId },
      { ...BASE, operation: "lock", metadata: {} },
      { ...BASE, version: 2, operation: "lock" },
      { ...BASE, operation: "removeVault", vaultId },
      {
        ...BASE,
        operation: "removeVault",
        vaultId,
        removalAuthorization: removalAuthorization("vault-other-12345678"),
      },
      {
        ...BASE,
        operation: "exportRecoveryEnvelope",
        vaultId,
        recoveryPassphrase: new Uint8Array(
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.recoveryPassphraseBytes + 1,
        ),
      },
      {
        ...BASE,
        operation: "sealHostedResult",
        vaultId,
        endpointId,
        jobId,
        jobHash: "AA".repeat(32),
        state: "completed",
        resultPayload: new Uint8Array(),
      },
    ];
    for (const value of invalid) {
      contractError(
        () => parsePrivateVaultNativeServiceRequest(value),
        "invalid_request",
      );
    }
  });

  it("copies every request and result byte array at the boundary", () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const parsedRequest = parsePrivateVaultNativeServiceRequest({
      ...BASE,
      operation: "sealContentObject",
      vaultId,
      objectId,
      revision: 1,
      contentType: "text/plain",
      plaintext,
    });
    expect(parsedRequest.operation).toBe("sealContentObject");
    if (parsedRequest.operation !== "sealContentObject") throw new Error();
    expect(parsedRequest.plaintext).not.toBe(plaintext);
    plaintext.fill(9);
    expect(parsedRequest.plaintext).toEqual(new Uint8Array([1, 2, 3]));

    const resultPayload = new Uint8Array([4, 5, 6]);
    const parsedResult = parsePrivateVaultNativeServiceResult({
      ...BASE,
      operation: "openHostedJob",
      jobPayload: resultPayload,
    });
    expect(parsedResult.operation).toBe("openHostedJob");
    if (parsedResult.operation !== "openHostedJob") throw new Error();
    expect(parsedResult.jobPayload).not.toBe(resultPayload);
    resultPayload.fill(0);
    expect(parsedResult.jobPayload).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("allows only the exact canonical anc/v1 unsigned endpoint proof", () => {
    for (const path of Object.values(BROKER_JOB_PATHS)) {
      expect(
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "signEndpointRequest",
          unsignedProof: unsignedEndpointProof({ path }),
        }).operation,
      ).toBe("signEndpointRequest");
    }

    const withUnknownField = encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [1, "anc/v1"],
        [2, 1],
        [3, "endpoint_request"],
        [4, vaultId],
        [5, endpointId],
        [6, "POST"],
        [7, "/api/private-vault/jobs/broker/claim"],
        [8, new Uint8Array(32).fill(1)],
        [9, "2026-07-16T12:00:00.000Z"],
        [10, "22".repeat(16)],
        [11, "forbidden"],
      ]),
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "signEndpointRequest",
          unsignedProof: withUnknownField,
        }),
      "invalid_request",
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceRequest({
          ...BASE,
          operation: "signEndpointRequest",
          unsignedProof: new Uint8Array([0xbf, 0xff]),
        }),
      "invalid_request",
    );
  });

  it("keeps health semantic and makes result failures content-free", () => {
    expect(
      parsePrivateVaultNativeServiceResult({
        ...BASE,
        operation: "health",
        state: "unavailable",
        available: false,
        ready: false,
        unlocked: false,
      }),
    ).toMatchObject({ state: "unavailable", available: false, ready: false });
    expect(
      parsePrivateVaultNativeServiceResult({
        ...BASE,
        operation: "health",
        state: "locked",
        available: true,
        ready: true,
        unlocked: false,
      }),
    ).toEqual({
      ...BASE,
      operation: "health",
      state: "locked",
      available: true,
      ready: true,
      unlocked: false,
    });
    contractError(
      () =>
        parsePrivateVaultNativeServiceResult({
          ...BASE,
          operation: "health",
          state: "locked",
          available: true,
          ready: true,
          unlocked: false,
          vaultId,
        }),
      "invalid_result",
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceResult({
          ...BASE,
          operation: "signEndpointRequest",
          signature: new Uint8Array(63),
        }),
      "invalid_result",
    );
    contractError(
      () =>
        parsePrivateVaultNativeServiceResult(
          new Proxy(
            { ...BASE, operation: "health" },
            {
              ownKeys() {
                throw new Error(`do not disclose ${vaultId}`);
              },
            },
          ),
        ),
      "invalid_result",
    );
  });

  it("has no raw-material, filesystem, provider, metadata-bag, or generic crypto methods", async () => {
    const source = await readFile(
      new URL("./native-service.ts", import.meta.url),
      "utf8",
    );
    const interfaceBody = source.match(
      /export interface PrivateVaultNativeService \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(interfaceBody).toBeDefined();
    expect(interfaceBody).not.toMatch(/\b(?:encrypt|decrypt|sign)\s*\(/);
    expect(source).not.toMatch(
      /\b(?:privateKey|vaultKey|recoveryKey|filePath|provider|metadata)\b/,
    );
  });
});
