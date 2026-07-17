import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type CeremonyKind,
  ceremonyKindSchema,
  ceremonyStepSchema,
} from "./ceremonies.js";
import type {
  ControlCeremonyAbort,
  ControlLogState,
  SignedControlLogEntry,
} from "./control-log.js";
import { ancV1Hash } from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const FIELDS = E2EE_ENVELOPE_FIELDS.ceremonyAbortState;
const HASH_BYTES = 32;

export type AncV1CeremonyKind = CeremonyKind;

/**
 * Abort records use transcript ceremony vocabulary, not membership-commit
 * vocabulary. Broker enrollment/removal remain add/remove-device ceremonies;
 * target role is bound in the replayed ceremony state outside this projection.
 */
export const ANC_V1_ABORT_MEMBERSHIP_KIND = Object.freeze({
  brokerEnrollment: "add_device" as const,
  brokerRemoval: "remove_device" as const,
});

export interface AncV1CeremonyAbortStateCommitment {
  suite: typeof E2EE_SUITE_ID;
  vaultId: string;
  type: "ceremony-abort-state";
  ceremonyId: string;
  ceremonyKind: AncV1CeremonyKind;
  epoch: number;
  expectedControlSequence: number;
  expectedControlHeadHash: Uint8Array;
  completedSteps: string[];
  alertCode: string | null;
  incompleteReason: string | null;
  plaintextOutstanding: boolean;
  abortReason: string;
  signerEndpointId: string;
}

export interface AncV1CeremonyAbortTranscriptState extends AncV1CeremonyAbortStateCommitment {
  status: "aborted";
  abortLogged: true;
  signedLogCommitted: false;
  priorTermination: null;
}

export class AncV1CeremonyAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1CeremonyAbortError";
  }
}

const KEYS = [
  COMMON.suite,
  COMMON.vaultId,
  COMMON.type,
  ...Object.values(FIELDS),
];
const PROPS = [
  "suite",
  "vaultId",
  "type",
  "ceremonyId",
  "ceremonyKind",
  "epoch",
  "expectedControlSequence",
  "expectedControlHeadHash",
  "completedSteps",
  "alertCode",
  "incompleteReason",
  "plaintextOutstanding",
  "abortReason",
  "signerEndpointId",
] as const;

function fail(message: string): never {
  throw new AncV1CeremonyAbortError(message);
}

function token(value: unknown, name: string, maximum = 120): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(value)
  )
    fail(`${name} must be a bounded protocol token`);
  return value;
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${name} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    fail(`${name} must be exactly ${length} bytes`);
  }
  return value.slice();
}

function kind(value: unknown): AncV1CeremonyKind {
  const parsed = ceremonyKindSchema.safeParse(value);
  if (!parsed.success) fail("ceremonyKind is invalid");
  return parsed.data;
}

function nullableToken(value: unknown, name: string): string | null {
  return value === null ? null : token(value, name);
}

function steps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 48) {
    fail("completedSteps must contain at most 48 ordered steps");
  }
  return value.map((step) => {
    const parsed = ceremonyStepSchema.safeParse(step);
    if (!parsed.success)
      fail("completedStep is not a transcript ceremony step");
    return parsed.data;
  });
}

function exact(value: object) {
  const actual = Object.keys(value).sort();
  const expected = [...PROPS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail("Abort state commitment must contain exactly the frozen fields");
  }
}

export function encodeAncV1CeremonyAbortStateCommitment(
  value: AncV1CeremonyAbortStateCommitment,
): Uint8Array {
  exact(value);
  if (typeof value.plaintextOutstanding !== "boolean") {
    fail("plaintextOutstanding must be boolean");
  }
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [
        COMMON.suite,
        value.suite === E2EE_SUITE_ID ? value.suite : fail("suite mismatch"),
      ],
      [COMMON.vaultId, token(value.vaultId, "vaultId", 320)],
      [
        COMMON.type,
        value.type === "ceremony-abort-state"
          ? value.type
          : fail("type mismatch"),
      ],
      [FIELDS.ceremonyId, token(value.ceremonyId, "ceremonyId", 320)],
      [FIELDS.ceremonyKind, kind(value.ceremonyKind)],
      [FIELDS.epoch, integer(value.epoch, 1, "epoch")],
      [
        FIELDS.expectedControlSequence,
        integer(value.expectedControlSequence, 0, "expectedControlSequence"),
      ],
      [
        FIELDS.expectedControlHeadHash,
        bytes(
          value.expectedControlHeadHash,
          HASH_BYTES,
          "expectedControlHeadHash",
        ),
      ],
      [FIELDS.completedSteps, steps(value.completedSteps)],
      [FIELDS.alertCode, nullableToken(value.alertCode, "alertCode")],
      [
        FIELDS.incompleteReason,
        nullableToken(value.incompleteReason, "incompleteReason"),
      ],
      [FIELDS.plaintextOutstanding, value.plaintextOutstanding],
      [FIELDS.abortReason, token(value.abortReason, "abortReason")],
      [
        FIELDS.signerEndpointId,
        token(value.signerEndpointId, "signerEndpointId", 320),
      ],
    ]),
  );
}

export function decodeAncV1CeremonyAbortStateCommitment(
  encoded: Uint8Array,
  binding: { expectedVaultId: string },
): AncV1CeremonyAbortStateCommitment {
  let map: ReadonlyMap<number, AncV1CanonicalValue>;
  try {
    map = decodeAncV1Envelope(encoded, KEYS, {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    });
  } catch (error) {
    if (error instanceof AncV1CanonicalEncodingError) {
      throw new AncV1CeremonyAbortError(error.message);
    }
    throw error;
  }
  if (map.size !== KEYS.length)
    fail("Abort state commitment is missing fields");
  const get = (key: number, name: string) => {
    if (!map.has(key)) fail(`Abort state commitment is missing ${name}`);
    return map.get(key)!;
  };
  const vaultId = token(get(COMMON.vaultId, "vaultId"), "vaultId", 320);
  if (vaultId !== binding.expectedVaultId) fail("Abort state vault mismatch");
  const outstanding = get(FIELDS.plaintextOutstanding, "plaintextOutstanding");
  if (typeof outstanding !== "boolean")
    fail("plaintextOutstanding must be boolean");
  return {
    suite:
      get(COMMON.suite, "suite") === E2EE_SUITE_ID
        ? E2EE_SUITE_ID
        : fail("suite mismatch"),
    vaultId,
    type:
      get(COMMON.type, "type") === "ceremony-abort-state"
        ? "ceremony-abort-state"
        : fail("type mismatch"),
    ceremonyId: token(get(FIELDS.ceremonyId, "ceremonyId"), "ceremonyId", 320),
    ceremonyKind: kind(get(FIELDS.ceremonyKind, "ceremonyKind")),
    epoch: integer(get(FIELDS.epoch, "epoch"), 1, "epoch"),
    expectedControlSequence: integer(
      get(FIELDS.expectedControlSequence, "expectedControlSequence"),
      0,
      "expectedControlSequence",
    ),
    expectedControlHeadHash: bytes(
      get(FIELDS.expectedControlHeadHash, "expectedControlHeadHash"),
      HASH_BYTES,
      "expectedControlHeadHash",
    ),
    completedSteps: steps(get(FIELDS.completedSteps, "completedSteps")),
    alertCode: nullableToken(get(FIELDS.alertCode, "alertCode"), "alertCode"),
    incompleteReason: nullableToken(
      get(FIELDS.incompleteReason, "incompleteReason"),
      "incompleteReason",
    ),
    plaintextOutstanding: outstanding,
    abortReason: token(get(FIELDS.abortReason, "abortReason"), "abortReason"),
    signerEndpointId: token(
      get(FIELDS.signerEndpointId, "signerEndpointId"),
      "signerEndpointId",
      320,
    ),
  };
}

export async function hashAncV1CeremonyAbortStateCommitment(
  value: AncV1CeremonyAbortStateCommitment,
): Promise<Uint8Array> {
  return ancV1Hash(
    "ceremony-abort",
    encodeAncV1CeremonyAbortStateCommitment(value),
  );
}

/**
 * Canonical authorization check for the control-log abort callback. The
 * caller supplies reducer-derived transcript state, not a pre-approved
 * boolean. Every field that can confer termination authority is rebound to
 * the exact signed edge and its authenticated predecessor.
 */
export async function verifyAncV1CeremonyAbortAuthorization(
  encodedCommitment: Uint8Array,
  transcriptState: AncV1CeremonyAbortTranscriptState,
  context: {
    abort: ControlCeremonyAbort;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  },
): Promise<boolean> {
  const transcriptKeys = Object.keys(transcriptState).sort();
  if (
    transcriptKeys.join("\0") !==
      [
        ...PROPS,
        "abortLogged",
        "priorTermination",
        "signedLogCommitted",
        "status",
      ]
        .sort()
        .join("\0") ||
    transcriptState.status !== "aborted" ||
    transcriptState.abortLogged !== true ||
    transcriptState.signedLogCommitted !== false ||
    transcriptState.priorTermination !== null ||
    transcriptState.plaintextOutstanding !== false
  ) {
    fail("Abort transcript is not an uncommitted terminal abort");
  }
  const contextKeys = Object.keys(context).sort();
  if (contextKeys.join("\0") !== ["abort", "current", "entry"].join("\0")) {
    fail("Abort authorization context must contain exactly reducer state");
  }
  const commitment = decodeAncV1CeremonyAbortStateCommitment(
    encodedCommitment,
    { expectedVaultId: context.current.vaultId },
  );
  const {
    status: _status,
    abortLogged: _abortLogged,
    signedLogCommitted: _signedLogCommitted,
    priorTermination: _priorTermination,
    ...replayedCommitment
  } = transcriptState;
  const canonicalReplay =
    encodeAncV1CeremonyAbortStateCommitment(replayedCommitment);
  if (
    canonicalReplay.byteLength !== encodedCommitment.byteLength ||
    canonicalReplay.some((byte, index) => byte !== encodedCommitment[index])
  ) {
    fail("Abort commitment does not equal the replay-derived ceremony state");
  }
  const hash = ancV1BytesToHex(
    await hashAncV1CeremonyAbortStateCommitment(commitment),
  );
  if (
    hash !== context.abort.ceremonyStateHash ||
    commitment.plaintextOutstanding !== false ||
    context.entry.innerEnvelope.type !== "ceremony_abort" ||
    context.entry.innerEnvelope.ceremonyStateHash !== hash ||
    context.entry.innerEnvelope.vaultId !== context.abort.vaultId ||
    context.entry.innerEnvelope.ceremonyId !== context.abort.ceremonyId ||
    context.entry.innerEnvelope.ceremonyKind !== context.abort.ceremonyKind ||
    context.entry.innerEnvelope.reasonCode !== context.abort.reasonCode ||
    context.abort.vaultId !== context.current.vaultId ||
    commitment.vaultId !== context.abort.vaultId ||
    commitment.ceremonyId !== context.abort.ceremonyId ||
    commitment.ceremonyKind !== context.abort.ceremonyKind ||
    commitment.epoch !== context.current.epoch ||
    commitment.abortReason !== context.abort.reasonCode ||
    commitment.signerEndpointId !== context.entry.signerEndpointId ||
    context.entry.signerEndpointId !== commitment.signerEndpointId ||
    commitment.expectedControlSequence !== context.current.sequence ||
    ancV1BytesToHex(commitment.expectedControlHeadHash) !==
      context.current.headHash ||
    context.entry.sequence !== context.current.sequence + 1 ||
    context.entry.previousHash !== context.current.headHash
  ) {
    fail("Abort commitment does not match the signed control transition");
  }
  return true;
}
