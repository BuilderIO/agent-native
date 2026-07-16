import { z } from "zod";

import {
  ciphertextObjectSchema,
  endpointStatusSchema,
  wrappedKeyEnvelopeSchema,
} from "./contracts.js";
import {
  assertHostedFieldsAllowed,
  resourcePrivacyManifestSchema,
} from "./privacy-manifest.js";

export const KNOWN_PLAINTEXT_SENTINEL =
  "E2EE_FIXTURE_PROTECTED_TEXT_MUST_NOT_REACH_HOSTED_STORAGE";

export const protocolFailureCodeSchema = z.enum([
  "known_plaintext",
  "wrong_recipient",
  "replay",
  "rollback",
  "removed_device",
  "corrupted_envelope",
  "broker_offline",
  "metadata_leakage",
]);

export type ProtocolFailureCode = z.infer<typeof protocolFailureCodeSchema>;

export type ProtocolFailureCheck =
  | {
      kind: "known_plaintext";
      hostedRecord: Record<string, unknown>;
    }
  | {
      kind: "wrong_recipient";
      expectedRecipientEndpointId: string;
      envelope: unknown;
    }
  | { kind: "replay"; sequence: number; highestAcceptedSequence: number }
  | { kind: "rollback"; object: unknown; minimumEpoch: number }
  | { kind: "removed_device"; endpoint: unknown }
  | { kind: "corrupted_envelope"; envelope: unknown }
  | { kind: "broker_offline"; endpoint: unknown }
  | {
      kind: "metadata_leakage";
      manifest: unknown;
      hostedRecord: Record<string, unknown>;
    };

export type ProtocolFailureOutcome =
  | { ok: true }
  | {
      ok: false;
      code: ProtocolFailureCode;
      disposition: "reject" | "queue_encrypted";
    };

function reject(code: ProtocolFailureCode): ProtocolFailureOutcome {
  return { ok: false, code, disposition: "reject" };
}

/**
 * Deterministic pre-crypto failure checks. Passing says only that these
 * contract/state invariants hold; it makes no authenticity or secrecy claim.
 */
export function validateProtocolState(
  check: ProtocolFailureCheck,
): ProtocolFailureOutcome {
  switch (check.kind) {
    case "known_plaintext":
      return JSON.stringify(check.hostedRecord).includes(
        KNOWN_PLAINTEXT_SENTINEL,
      )
        ? reject("known_plaintext")
        : { ok: true };
    case "wrong_recipient": {
      const envelope = wrappedKeyEnvelopeSchema.safeParse(check.envelope);
      if (!envelope.success) return reject("corrupted_envelope");
      return envelope.data.recipientEndpointId ===
        check.expectedRecipientEndpointId
        ? { ok: true }
        : reject("wrong_recipient");
    }
    case "replay":
      return check.sequence <= check.highestAcceptedSequence
        ? reject("replay")
        : { ok: true };
    case "rollback": {
      const object = ciphertextObjectSchema.safeParse(check.object);
      if (!object.success) return reject("corrupted_envelope");
      return object.data.opaqueRevision.epoch < check.minimumEpoch
        ? reject("rollback")
        : { ok: true };
    }
    case "removed_device": {
      const endpoint = endpointStatusSchema.safeParse(check.endpoint);
      if (
        !endpoint.success ||
        ["removed", "revoked"].includes(endpoint.data.state)
      ) {
        return reject("removed_device");
      }
      return { ok: true };
    }
    case "corrupted_envelope":
      return wrappedKeyEnvelopeSchema.safeParse(check.envelope).success
        ? { ok: true }
        : reject("corrupted_envelope");
    case "broker_offline": {
      const endpoint = endpointStatusSchema.safeParse(check.endpoint);
      return !endpoint.success || endpoint.data.state !== "online"
        ? {
            ok: false,
            code: "broker_offline",
            disposition: "queue_encrypted",
          }
        : { ok: true };
    }
    case "metadata_leakage":
      try {
        resourcePrivacyManifestSchema.parse(check.manifest);
        assertHostedFieldsAllowed(check.manifest, check.hostedRecord);
        return { ok: true };
      } catch {
        return reject("metadata_leakage");
      }
  }
}
