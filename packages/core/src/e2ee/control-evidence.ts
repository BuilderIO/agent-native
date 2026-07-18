import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import { E2EE_SIZE_LIMITS, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_RECOVERY_CONTROL_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;
const ANC_V1_RECOVERY_AUTHORIZATION_MAX_BYTES = 1024 * 1024;

export interface AncV1RecoveryControlEvidence {
  suite: typeof E2EE_SUITE_ID;
  version: 1;
  type: "recovery-control-evidence";
  currentSnapshot: Uint8Array;
  recoveryAuthorization: Uint8Array;
}

const FIELDS = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  currentSnapshot: 4,
  recoveryAuthorization: 5,
});
const KEYS = Object.values(FIELDS);

export class AncV1ControlEvidenceCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1ControlEvidenceCodecError";
  }
}

function fail(message: string): never {
  throw new AncV1ControlEvidenceCodecError(message);
}

function bytes(value: unknown, maximum: number, name: string): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    fail(`${name} must contain between 1 and ${maximum} bytes`);
  }
  return value.slice();
}

function field(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  name: string,
): AncV1CanonicalValue {
  if (!map.has(key)) fail(`Control evidence is missing ${name}`);
  return map.get(key)!;
}

export function encodeAncV1RecoveryControlEvidence(
  value: AncV1RecoveryControlEvidence,
): Uint8Array {
  if (
    value.suite !== E2EE_SUITE_ID ||
    value.version !== 1 ||
    value.type !== "recovery-control-evidence"
  ) {
    fail("Control evidence must use the frozen anc/v1 recovery envelope");
  }
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [FIELDS.suite, E2EE_SUITE_ID],
      [FIELDS.version, 1],
      [FIELDS.type, "recovery-control-evidence"],
      [
        FIELDS.currentSnapshot,
        bytes(
          value.currentSnapshot,
          E2EE_SIZE_LIMITS.controlEnvelopeBytes,
          "currentSnapshot",
        ),
      ],
      [
        FIELDS.recoveryAuthorization,
        bytes(
          value.recoveryAuthorization,
          ANC_V1_RECOVERY_AUTHORIZATION_MAX_BYTES,
          "recoveryAuthorization",
        ),
      ],
    ]),
  );
  if (encoded.byteLength > ANC_V1_RECOVERY_CONTROL_EVIDENCE_MAX_BYTES) {
    fail("Recovery control evidence exceeds its frozen maximum");
  }
  return encoded;
}

export function decodeAncV1RecoveryControlEvidence(
  encoded: Uint8Array,
): AncV1RecoveryControlEvidence {
  try {
    const map = decodeAncV1Envelope(encoded, KEYS, {
      maxBytes: ANC_V1_RECOVERY_CONTROL_EVIDENCE_MAX_BYTES,
    });
    if (
      map.get(FIELDS.suite) !== E2EE_SUITE_ID ||
      map.get(FIELDS.version) !== 1 ||
      map.get(FIELDS.type) !== "recovery-control-evidence"
    ) {
      fail("Control evidence must use the frozen anc/v1 recovery envelope");
    }
    return {
      suite: E2EE_SUITE_ID,
      version: 1,
      type: "recovery-control-evidence",
      currentSnapshot: bytes(
        field(map, FIELDS.currentSnapshot, "currentSnapshot"),
        E2EE_SIZE_LIMITS.controlEnvelopeBytes,
        "currentSnapshot",
      ),
      recoveryAuthorization: bytes(
        field(map, FIELDS.recoveryAuthorization, "recoveryAuthorization"),
        ANC_V1_RECOVERY_AUTHORIZATION_MAX_BYTES,
        "recoveryAuthorization",
      ),
    };
  } catch (error) {
    if (error instanceof AncV1ControlEvidenceCodecError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) {
      fail(error.message);
    }
    throw error;
  }
}
