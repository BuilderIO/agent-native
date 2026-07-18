import {
  decodeSignedControlLogEntry,
  decodeAncV1Envelope,
  E2EE_SIZE_LIMITS,
  encodeSignedControlLogEntry,
  encodeEndpointRequestUnsignedProof,
  endpointRequestUnsignedProofSchema,
  opaqueIdSchema,
  type AncV1CanonicalValue,
  type EndpointRequestUnsignedProof,
} from "@agent-native/core/e2ee";

import { BROKER_JOB_PATHS } from "./transport.js";

export const PRIVATE_VAULT_NATIVE_SERVICE_VERSION = 1 as const;
export const PRIVATE_VAULT_NATIVE_SERVICE_SUITE = "anc/v1" as const;

export const PRIVATE_VAULT_NATIVE_SERVICE_LIMITS = Object.freeze({
  endpointEnvelopeBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  recoveryEnvelopeBytes: 1024 * 1024,
  recoveryPassphraseBytes: 1024,
  contentEnvelopeBytes: E2EE_SIZE_LIMITS.objectPlaintextBytes + 2 * 1024 * 1024,
  contentPlaintextBytes: E2EE_SIZE_LIMITS.objectPlaintextBytes,
  hostedJobEnvelopeBytes: E2EE_SIZE_LIMITS.jobEnvelopeBytes,
  hostedJobPayloadBytes: E2EE_SIZE_LIMITS.jobPayloadBytes,
  hostedResultEnvelopeBytes: E2EE_SIZE_LIMITS.resultEnvelopeBytes,
  hostedResultPayloadBytes: E2EE_SIZE_LIMITS.resultPayloadBytes,
  endpointRequestBytes: 64 * 1024,
  endpointSignatureBytes: 64,
  removalAuthorizationBytes: E2EE_SIZE_LIMITS.vaultLogEntryBytes,
});

type ServiceHeader<Operation extends string> = {
  readonly version: typeof PRIVATE_VAULT_NATIVE_SERVICE_VERSION;
  readonly suite: typeof PRIVATE_VAULT_NATIVE_SERVICE_SUITE;
  readonly operation: Operation;
};

export type PrivateVaultNativeServiceState =
  | "unavailable"
  | "uninitialized"
  | "locked"
  | "unlocked"
  | "closed";

export type NativeHealthRequest = ServiceHeader<"health">;
export type NativeHealthResult = ServiceHeader<"health"> & {
  readonly state: PrivateVaultNativeServiceState;
  readonly available: boolean;
  readonly ready: boolean;
  readonly unlocked: boolean;
  readonly rotationAckState:
    | "unavailable"
    | "idle"
    | "pending"
    | "retrying"
    | "attention";
};

export type NativeEnrollVaultRequest = ServiceHeader<"enrollVault"> & {
  readonly vaultId: string;
  readonly endpointId: string;
};
export type NativeEnrollVaultResult = ServiceHeader<"enrollVault"> & {
  readonly endpointEnvelope: Uint8Array;
};

export type NativeImportRecoveryRequest = ServiceHeader<"importRecovery"> & {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly recoveryEnvelope: Uint8Array;
  readonly recoveryPassphrase: Uint8Array;
};
export type NativeImportRecoveryResult = ServiceHeader<"importRecovery"> & {
  readonly endpointEnvelope: Uint8Array;
};

export type NativeRemoveVaultRequest = ServiceHeader<"removeVault"> & {
  readonly vaultId: string;
  /**
   * Canonical signed remove-device/remove-broker control-log entry. Before
   * deletion, the implementation must authenticate it against the current
   * control head and prove that it removes this local endpoint or broker.
   */
  readonly removalAuthorization: Uint8Array;
};
export type NativeRemoveVaultResult = ServiceHeader<"removeVault"> & {
  readonly removed: true;
};

export type NativeUnlockRequest = ServiceHeader<"unlock"> & {
  readonly vaultId: string;
};
export type NativeUnlockResult = ServiceHeader<"unlock"> & {
  readonly state: "unlocked";
};

export type NativeLockRequest = ServiceHeader<"lock">;
export type NativeLockResult = ServiceHeader<"lock"> & {
  readonly state: "locked";
};

export type NativeSealContentObjectRequest =
  ServiceHeader<"sealContentObject"> & {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly contentType: string;
    readonly plaintext: Uint8Array;
  };
export type NativeSealContentObjectResult =
  ServiceHeader<"sealContentObject"> & {
    readonly objectEnvelope: Uint8Array;
  };

export type NativeOpenContentObjectRequest =
  ServiceHeader<"openContentObject"> & {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly objectEnvelope: Uint8Array;
  };
export type NativeOpenContentObjectResult =
  ServiceHeader<"openContentObject"> & {
    readonly contentType: string;
    readonly plaintext: Uint8Array;
  };

export type NativeOpenHostedJobRequest = ServiceHeader<"openHostedJob"> & {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly jobId: string;
  readonly jobEnvelope: Uint8Array;
};
export type NativeOpenHostedJobResult = ServiceHeader<"openHostedJob"> & {
  readonly jobPayload: Uint8Array;
  readonly jobHash: string;
};

export type NativeSealHostedResultRequest =
  ServiceHeader<"sealHostedResult"> & {
    readonly vaultId: string;
    readonly endpointId: string;
    readonly jobId: string;
    readonly jobHash: string;
    readonly state: "completed" | "failed";
    readonly resultPayload: Uint8Array;
  };
export type NativeSealHostedResultResult = ServiceHeader<"sealHostedResult"> & {
  readonly resultEnvelope: Uint8Array;
};

export type NativeAcknowledgeHostedResultRequest =
  ServiceHeader<"acknowledgeHostedResult"> & {
    readonly vaultId: string;
    readonly endpointId: string;
    readonly jobId: string;
    readonly jobHash: string;
    readonly state: "completed" | "failed";
  };
export type NativeAcknowledgeHostedResultResult =
  ServiceHeader<"acknowledgeHostedResult"> & {
    readonly delivered: true;
  };

export type NativeSignEndpointRequestRequest =
  ServiceHeader<"signEndpointRequest"> & {
    /**
     * Unique canonical anc/v1 unsigned proof bytes for POST on exactly one of
     * the five broker-job routes. The implementation must reject a proof whose
     * vault and endpoint identities differ from the currently unlocked local
     * broker identity; the caller has no separate identity override.
     */
    readonly unsignedProof: Uint8Array;
  };
export type NativeSignEndpointRequestResult =
  ServiceHeader<"signEndpointRequest"> & {
    readonly signature: Uint8Array;
  };

export type NativeExportRecoveryEnvelopeRequest =
  ServiceHeader<"exportRecoveryEnvelope"> & {
    readonly vaultId: string;
    readonly recoveryPassphrase: Uint8Array;
  };
export type NativeExportRecoveryEnvelopeResult =
  ServiceHeader<"exportRecoveryEnvelope"> & {
    readonly recoveryEnvelope: Uint8Array;
  };

export type PrivateVaultNativeServiceRequest =
  | NativeHealthRequest
  | NativeEnrollVaultRequest
  | NativeImportRecoveryRequest
  | NativeRemoveVaultRequest
  | NativeUnlockRequest
  | NativeLockRequest
  | NativeSealContentObjectRequest
  | NativeOpenContentObjectRequest
  | NativeOpenHostedJobRequest
  | NativeSealHostedResultRequest
  | NativeAcknowledgeHostedResultRequest
  | NativeSignEndpointRequestRequest
  | NativeExportRecoveryEnvelopeRequest;

export type PrivateVaultNativeServiceResult =
  | NativeHealthResult
  | NativeEnrollVaultResult
  | NativeImportRecoveryResult
  | NativeRemoveVaultResult
  | NativeUnlockResult
  | NativeLockResult
  | NativeSealContentObjectResult
  | NativeOpenContentObjectResult
  | NativeOpenHostedJobResult
  | NativeSealHostedResultResult
  | NativeAcknowledgeHostedResultResult
  | NativeSignEndpointRequestResult
  | NativeExportRecoveryEnvelopeResult;

/**
 * Trusted-main-process boundary. Implementations must not retain request byte
 * arrays, and callers must treat returned arrays as transferred snapshots.
 */
export interface PrivateVaultNativeService {
  health(request: NativeHealthRequest): Promise<NativeHealthResult>;
  enrollVault(
    request: NativeEnrollVaultRequest,
  ): Promise<NativeEnrollVaultResult>;
  importRecovery(
    request: NativeImportRecoveryRequest,
  ): Promise<NativeImportRecoveryResult>;
  removeVault(
    request: NativeRemoveVaultRequest,
  ): Promise<NativeRemoveVaultResult>;
  unlock(request: NativeUnlockRequest): Promise<NativeUnlockResult>;
  lock(request: NativeLockRequest): Promise<NativeLockResult>;
  sealContentObject(
    request: NativeSealContentObjectRequest,
  ): Promise<NativeSealContentObjectResult>;
  openContentObject(
    request: NativeOpenContentObjectRequest,
  ): Promise<NativeOpenContentObjectResult>;
  openHostedJob(
    request: NativeOpenHostedJobRequest,
  ): Promise<NativeOpenHostedJobResult>;
  sealHostedResult(
    request: NativeSealHostedResultRequest,
  ): Promise<NativeSealHostedResultResult>;
  acknowledgeHostedResult(
    request: NativeAcknowledgeHostedResultRequest,
  ): Promise<NativeAcknowledgeHostedResultResult>;
  signEndpointRequest(
    request: NativeSignEndpointRequestRequest,
  ): Promise<NativeSignEndpointRequestResult>;
  exportRecoveryEnvelope(
    request: NativeExportRecoveryEnvelopeRequest,
  ): Promise<NativeExportRecoveryEnvelopeResult>;
}

export type PrivateVaultNativeServiceContractErrorCode =
  | "invalid_request"
  | "invalid_result";

export class PrivateVaultNativeServiceContractError extends Error {
  readonly code: PrivateVaultNativeServiceContractErrorCode;

  constructor(code: PrivateVaultNativeServiceContractErrorCode) {
    super("Private vault native service contract rejected data");
    this.name = "PrivateVaultNativeServiceContractError";
    this.code = code;
  }
}

const HEADER_KEYS = ["operation", "suite", "version"] as const;
const CONTENT_TYPE = /^[a-z][a-z0-9.+-]{0,59}(?:\/[a-z0-9][a-z0-9.+-]{0,59})?$/;
const LOWERCASE_HEX_32 = /^[0-9a-f]{64}$/;
const SIGNABLE_BROKER_JOB_PATHS = new Set<string>(
  Object.values(BROKER_JOB_PATHS),
);

function fail(code: PrivateVaultNativeServiceContractErrorCode): never {
  throw new PrivateVaultNativeServiceContractError(code);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_request");
  const record = value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(record) !== Object.prototype ||
    Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    fail("invalid_request");
  }
  return record;
}

function header(
  value: unknown,
  operation: PrivateVaultNativeServiceRequest["operation"],
  keys: readonly string[],
): Record<string, unknown> {
  const record = exactRecord(value, [...HEADER_KEYS, ...keys]);
  if (
    record.version !== PRIVATE_VAULT_NATIVE_SERVICE_VERSION ||
    record.suite !== PRIVATE_VAULT_NATIVE_SERVICE_SUITE ||
    record.operation !== operation
  ) {
    fail("invalid_request");
  }
  return record;
}

function resultHeader(
  value: unknown,
  operation: PrivateVaultNativeServiceResult["operation"],
  keys: readonly string[],
): Record<string, unknown> {
  try {
    return header(value, operation, keys);
  } catch {
    fail("invalid_result");
  }
}

function id(value: unknown): string {
  const parsed = opaqueIdSchema.safeParse(value);
  if (!parsed.success) fail("invalid_request");
  return parsed.data;
}

function bytes(value: unknown, min: number, max: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < min ||
    value.byteLength > max
  ) {
    fail("invalid_request");
  }
  return Uint8Array.from(value);
}

function resultBytes(value: unknown, min: number, max: number): Uint8Array {
  try {
    return bytes(value, min, max);
  } catch {
    fail("invalid_result");
  }
}

function positiveRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    fail("invalid_request");
  return value as number;
}

function contentType(
  value: unknown,
  code: PrivateVaultNativeServiceContractErrorCode,
): string {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !CONTENT_TYPE.test(value)
  )
    fail(code);
  return value;
}

function base<Operation extends PrivateVaultNativeServiceRequest["operation"]>(
  operation: Operation,
): ServiceHeader<Operation> {
  return {
    version: PRIVATE_VAULT_NATIVE_SERVICE_VERSION,
    suite: PRIVATE_VAULT_NATIVE_SERVICE_SUITE,
    operation,
  };
}

function assertExactEndpointUnsignedProof(encoded: Uint8Array): void {
  try {
    const envelope = decodeAncV1Envelope(
      encoded,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      {
        maxBytes: PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.endpointRequestBytes,
      },
    );
    const at = (key: number): AncV1CanonicalValue => {
      const value = envelope.get(key);
      if (value === undefined) throw new Error();
      return value;
    };
    const hash = at(8);
    if (!(hash instanceof Uint8Array) || hash.byteLength !== 32)
      throw new Error();
    const proof = endpointRequestUnsignedProofSchema.parse({
      suite: at(1),
      version: at(2),
      type: at(3),
      vaultId: at(4),
      endpointId: at(5),
      method: at(6),
      path: at(7),
      bodyHash: Buffer.from(hash).toString("hex"),
      issuedAt: at(9),
      nonce: at(10),
    }) as EndpointRequestUnsignedProof;
    if (proof.method !== "POST" || !SIGNABLE_BROKER_JOB_PATHS.has(proof.path)) {
      throw new Error();
    }
    const canonical = encodeEndpointRequestUnsignedProof(proof);
    if (
      canonical.byteLength !== encoded.byteLength ||
      canonical.some((byte, index) => byte !== encoded[index])
    ) {
      throw new Error();
    }
  } catch {
    fail("invalid_request");
  }
}

function assertRemovalAuthorization(
  encoded: Uint8Array,
  expectedVaultId: string,
): void {
  try {
    const entry = decodeSignedControlLogEntry(encoded);
    const commit = entry.innerEnvelope;
    if (
      entry.vaultId !== expectedVaultId ||
      commit.vaultId !== expectedVaultId ||
      commit.type !== "membership_commit" ||
      (commit.ceremonyKind !== "remove_device" &&
        commit.ceremonyKind !== "remove_broker") ||
      commit.removedEndpointIds.length === 0 ||
      !commit.rotationCompleted ||
      !commit.outstandingJobsResolved
    ) {
      throw new Error();
    }
    const canonical = encodeSignedControlLogEntry(entry);
    if (
      canonical.byteLength !== encoded.byteLength ||
      canonical.some((byte, index) => byte !== encoded[index])
    ) {
      throw new Error();
    }
  } catch {
    fail("invalid_request");
  }
}

function parseRequestUnchecked(
  value: unknown,
): PrivateVaultNativeServiceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_request");
  const operation = (value as Record<string, unknown>).operation;
  switch (operation) {
    case "health": {
      header(value, operation, []);
      return base(operation);
    }
    case "enrollVault": {
      const record = header(value, operation, ["vaultId", "endpointId"]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        endpointId: id(record.endpointId),
      };
    }
    case "importRecovery": {
      const record = header(value, operation, [
        "vaultId",
        "endpointId",
        "recoveryEnvelope",
        "recoveryPassphrase",
      ]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        endpointId: id(record.endpointId),
        recoveryEnvelope: bytes(
          record.recoveryEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.recoveryEnvelopeBytes,
        ),
        recoveryPassphrase: bytes(
          record.recoveryPassphrase,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.recoveryPassphraseBytes,
        ),
      };
    }
    case "unlock": {
      const record = header(value, operation, ["vaultId"]);
      return { ...base(operation), vaultId: id(record.vaultId) };
    }
    case "removeVault": {
      const record = header(value, operation, [
        "vaultId",
        "removalAuthorization",
      ]);
      const parsedVaultId = id(record.vaultId);
      const removalAuthorization = bytes(
        record.removalAuthorization,
        1,
        PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.removalAuthorizationBytes,
      );
      assertRemovalAuthorization(removalAuthorization, parsedVaultId);
      return {
        ...base(operation),
        vaultId: parsedVaultId,
        removalAuthorization,
      };
    }
    case "lock": {
      header(value, operation, []);
      return base(operation);
    }
    case "sealContentObject": {
      const record = header(value, operation, [
        "vaultId",
        "objectId",
        "revision",
        "contentType",
        "plaintext",
      ]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        objectId: id(record.objectId),
        revision: positiveRevision(record.revision),
        contentType: contentType(record.contentType, "invalid_request"),
        plaintext: bytes(
          record.plaintext,
          0,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.contentPlaintextBytes,
        ),
      };
    }
    case "openContentObject": {
      const record = header(value, operation, [
        "vaultId",
        "objectId",
        "revision",
        "objectEnvelope",
      ]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        objectId: id(record.objectId),
        revision: positiveRevision(record.revision),
        objectEnvelope: bytes(
          record.objectEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.contentEnvelopeBytes,
        ),
      };
    }
    case "openHostedJob": {
      const record = header(value, operation, [
        "vaultId",
        "endpointId",
        "jobId",
        "jobEnvelope",
      ]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        endpointId: id(record.endpointId),
        jobId: id(record.jobId),
        jobEnvelope: bytes(
          record.jobEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.hostedJobEnvelopeBytes,
        ),
      };
    }
    case "sealHostedResult": {
      const record = header(value, operation, [
        "vaultId",
        "endpointId",
        "jobId",
        "jobHash",
        "state",
        "resultPayload",
      ]);
      if (
        typeof record.jobHash !== "string" ||
        !LOWERCASE_HEX_32.test(record.jobHash)
      )
        fail("invalid_request");
      if (record.state !== "completed" && record.state !== "failed")
        fail("invalid_request");
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        endpointId: id(record.endpointId),
        jobId: id(record.jobId),
        jobHash: record.jobHash,
        state: record.state,
        resultPayload: bytes(
          record.resultPayload,
          0,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.hostedResultPayloadBytes,
        ),
      };
    }
    case "acknowledgeHostedResult": {
      const record = header(value, operation, [
        "vaultId",
        "endpointId",
        "jobId",
        "jobHash",
        "state",
      ]);
      if (
        typeof record.jobHash !== "string" ||
        !LOWERCASE_HEX_32.test(record.jobHash) ||
        (record.state !== "completed" && record.state !== "failed")
      )
        fail("invalid_request");
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        endpointId: id(record.endpointId),
        jobId: id(record.jobId),
        jobHash: record.jobHash,
        state: record.state,
      };
    }
    case "signEndpointRequest": {
      const record = header(value, operation, ["unsignedProof"]);
      const unsignedProof = bytes(
        record.unsignedProof,
        1,
        PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.endpointRequestBytes,
      );
      assertExactEndpointUnsignedProof(unsignedProof);
      return { ...base(operation), unsignedProof };
    }
    case "exportRecoveryEnvelope": {
      const record = header(value, operation, [
        "vaultId",
        "recoveryPassphrase",
      ]);
      return {
        ...base(operation),
        vaultId: id(record.vaultId),
        recoveryPassphrase: bytes(
          record.recoveryPassphrase,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.recoveryPassphraseBytes,
        ),
      };
    }
    default:
      fail("invalid_request");
  }
}

function parseResultUnchecked(value: unknown): PrivateVaultNativeServiceResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_result");
  const operation = (value as Record<string, unknown>).operation;
  switch (operation) {
    case "health": {
      const record = resultHeader(value, operation, [
        "state",
        "available",
        "ready",
        "unlocked",
        "rotationAckState",
      ]);
      if (
        ![
          "unavailable",
          "uninitialized",
          "locked",
          "unlocked",
          "closed",
        ].includes(record.state as string)
      )
        fail("invalid_result");
      if (
        typeof record.available !== "boolean" ||
        typeof record.ready !== "boolean" ||
        typeof record.unlocked !== "boolean" ||
        !["unavailable", "idle", "pending", "retrying", "attention"].includes(
          record.rotationAckState as string,
        )
      )
        fail("invalid_result");
      if (
        record.available !== (record.state !== "unavailable") ||
        record.unlocked !== (record.state === "unlocked") ||
        record.ready !==
          (record.state === "locked" || record.state === "unlocked") ||
        (record.state === "unavailable") !==
          (record.rotationAckState === "unavailable")
      )
        fail("invalid_result");
      return {
        ...base(operation),
        state: record.state as PrivateVaultNativeServiceState,
        available: record.available,
        ready: record.ready,
        unlocked: record.unlocked,
        rotationAckState:
          record.rotationAckState as NativeHealthResult["rotationAckState"],
      };
    }
    case "enrollVault":
    case "importRecovery": {
      const record = resultHeader(value, operation, ["endpointEnvelope"]);
      return {
        ...base(operation),
        endpointEnvelope: resultBytes(
          record.endpointEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.endpointEnvelopeBytes,
        ),
      };
    }
    case "removeVault": {
      const record = resultHeader(value, operation, ["removed"]);
      if (record.removed !== true) fail("invalid_result");
      return { ...base(operation), removed: true };
    }
    case "unlock": {
      const record = resultHeader(value, operation, ["state"]);
      if (record.state !== "unlocked") fail("invalid_result");
      return { ...base(operation), state: "unlocked" };
    }
    case "lock": {
      const record = resultHeader(value, operation, ["state"]);
      if (record.state !== "locked") fail("invalid_result");
      return { ...base(operation), state: "locked" };
    }
    case "sealContentObject": {
      const record = resultHeader(value, operation, ["objectEnvelope"]);
      return {
        ...base(operation),
        objectEnvelope: resultBytes(
          record.objectEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.contentEnvelopeBytes,
        ),
      };
    }
    case "openContentObject": {
      const record = resultHeader(value, operation, [
        "contentType",
        "plaintext",
      ]);
      return {
        ...base(operation),
        contentType: contentType(record.contentType, "invalid_result"),
        plaintext: resultBytes(
          record.plaintext,
          0,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.contentPlaintextBytes,
        ),
      };
    }
    case "openHostedJob": {
      const record = resultHeader(value, operation, ["jobHash", "jobPayload"]);
      if (
        typeof record.jobHash !== "string" ||
        !LOWERCASE_HEX_32.test(record.jobHash)
      ) {
        fail("invalid_result");
      }
      return {
        ...base(operation),
        jobHash: record.jobHash,
        jobPayload: resultBytes(
          record.jobPayload,
          0,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.hostedJobPayloadBytes,
        ),
      };
    }
    case "sealHostedResult": {
      const record = resultHeader(value, operation, ["resultEnvelope"]);
      return {
        ...base(operation),
        resultEnvelope: resultBytes(
          record.resultEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.hostedResultEnvelopeBytes,
        ),
      };
    }
    case "acknowledgeHostedResult": {
      const record = resultHeader(value, operation, ["delivered"]);
      if (record.delivered !== true) fail("invalid_result");
      return { ...base(operation), delivered: true };
    }
    case "signEndpointRequest": {
      const record = resultHeader(value, operation, ["signature"]);
      return {
        ...base(operation),
        signature: resultBytes(
          record.signature,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.endpointSignatureBytes,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.endpointSignatureBytes,
        ),
      };
    }
    case "exportRecoveryEnvelope": {
      const record = resultHeader(value, operation, ["recoveryEnvelope"]);
      return {
        ...base(operation),
        recoveryEnvelope: resultBytes(
          record.recoveryEnvelope,
          1,
          PRIVATE_VAULT_NATIVE_SERVICE_LIMITS.recoveryEnvelopeBytes,
        ),
      };
    }
    default:
      fail("invalid_result");
  }
}

export function parsePrivateVaultNativeServiceRequest(
  value: unknown,
): PrivateVaultNativeServiceRequest {
  try {
    return parseRequestUnchecked(value);
  } catch (error) {
    if (
      error instanceof PrivateVaultNativeServiceContractError &&
      error.code === "invalid_request"
    ) {
      throw error;
    }
    fail("invalid_request");
  }
}

export function parsePrivateVaultNativeServiceResult(
  value: unknown,
): PrivateVaultNativeServiceResult {
  try {
    return parseResultUnchecked(value);
  } catch (error) {
    if (
      error instanceof PrivateVaultNativeServiceContractError &&
      error.code === "invalid_result"
    ) {
      throw error;
    }
    fail("invalid_result");
  }
}
