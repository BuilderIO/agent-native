import type {
  ProtocolFailureCheck,
  ProtocolFailureCode,
} from "./failure-vectors.js";
import { KNOWN_PLAINTEXT_SENTINEL } from "./failure-vectors.js";
import {
  PERSONAL_VAULT_V1_ADMITTED_LEAKAGE,
  PERSONAL_VAULT_V1_HOSTED_FIELDS,
  PERSONAL_VAULT_V1_RETENTION,
} from "./privacy-manifest.js";

const now = "2026-07-16T12:00:00.000Z";

export const protocolFixtureManifest = {
  version: 1,
  resourceType: "document",
  protectedFields: ["title", "body", "properties", "searchIndex"],
  hostedFields: PERSONAL_VAULT_V1_HOSTED_FIELDS,
  executionPlacement: "trusted_endpoint",
  egress: {
    default: "deny",
    requiresCapabilityGrant: true,
    providerBound: true,
    destinationBound: true,
  },
  admittedLeakage: PERSONAL_VAULT_V1_ADMITTED_LEAKAGE,
  retention: PERSONAL_VAULT_V1_RETENTION,
  failClosedFeatures: ["search", "agent_action", "background_automation"],
} as const;

export const protocolFixtureEnvelope = {
  version: 1,
  envelopeId: "envelope:fixture-01",
  vaultId: "vault:fixture-01",
  epoch: 2,
  senderEndpointId: "endpoint:fixture-sender",
  recipientEndpointId: "endpoint:fixture-recipient",
  algorithmId: "opaque.algorithm.fixture-v1",
  wrappedKey: "opaque-wrapped-key-fixture",
  serverReceivedAt: now,
  expiresAt: null,
} as const;

export const protocolFixtureEndpoint = {
  version: 1,
  endpointId: "endpoint:fixture-recipient",
  vaultId: "vault:fixture-01",
  state: "removed",
  serverReceivedAt: now,
  lastIntegrityAt: null,
} as const;

export const protocolFixtureObject = {
  version: 1,
  accountId: "account:fixture-01",
  workspaceId: "workspace:fixture-01",
  vaultId: "vault:fixture-01",
  objectId: "object:fixture-01",
  objectType: "document",
  opaqueRevision: {
    version: 1,
    vaultId: "vault:fixture-01",
    objectId: "object:fixture-01",
    revisionId: "revision:fixture-01",
    revision: 1,
    parentRevisionIds: [],
    epoch: 1,
    ciphertextByteLength: 28,
    serverReceivedAt: now,
  },
  algorithmId: "opaque.algorithm.fixture-v1",
  ciphertext: "opaque-ciphertext-fixture-01",
} as const;

export interface ProtocolFailureFixture {
  fixtureId: string;
  name: ProtocolFailureCode;
  expected: ProtocolFailureCode;
  expectedDisposition: "reject" | "queue_encrypted";
  check: ProtocolFailureCheck;
}

/**
 * Fixed, synthetic failure corpus. These vectors exercise validation and state
 * transitions only; they are explicitly not cryptographic test vectors.
 */
export const PROTOCOL_FAILURE_FIXTURES: readonly ProtocolFailureFixture[] = [
  {
    fixtureId: "known-plaintext-sentinel",
    name: "known_plaintext",
    expected: "known_plaintext",
    expectedDisposition: "reject",
    check: {
      kind: "known_plaintext",
      hostedRecord: { ciphertext: `fixture:${KNOWN_PLAINTEXT_SENTINEL}` },
    },
  },
  {
    fixtureId: "wrong-envelope-recipient",
    name: "wrong_recipient",
    expected: "wrong_recipient",
    expectedDisposition: "reject",
    check: {
      kind: "wrong_recipient",
      expectedRecipientEndpointId: "endpoint:fixture-other",
      envelope: protocolFixtureEnvelope,
    },
  },
  {
    fixtureId: "replayed-sequence",
    name: "replay",
    expected: "replay",
    expectedDisposition: "reject",
    check: { kind: "replay", sequence: 7, highestAcceptedSequence: 7 },
  },
  {
    fixtureId: "stale-key-epoch",
    name: "rollback",
    expected: "rollback",
    expectedDisposition: "reject",
    check: { kind: "rollback", object: protocolFixtureObject, minimumEpoch: 2 },
  },
  {
    fixtureId: "removed-endpoint",
    name: "removed_device",
    expected: "removed_device",
    expectedDisposition: "reject",
    check: { kind: "removed_device", endpoint: protocolFixtureEndpoint },
  },
  {
    fixtureId: "malformed-wrapped-key",
    name: "corrupted_envelope",
    expected: "corrupted_envelope",
    expectedDisposition: "reject",
    check: {
      kind: "corrupted_envelope",
      envelope: { ...protocolFixtureEnvelope, wrappedKey: "" },
    },
  },
  {
    fixtureId: "unreachable-broker",
    name: "broker_offline",
    expected: "broker_offline",
    expectedDisposition: "queue_encrypted",
    check: {
      kind: "broker_offline",
      endpoint: { ...protocolFixtureEndpoint, state: "offline" },
    },
  },
  {
    fixtureId: "top-level-protected-title",
    name: "metadata_leakage",
    expected: "metadata_leakage",
    expectedDisposition: "reject",
    check: {
      kind: "metadata_leakage",
      manifest: protocolFixtureManifest,
      hostedRecord: {
        version: 1,
        vaultId: "vault:fixture-01",
        objectId: "object:fixture-01",
        title: "synthetic protected title",
      },
    },
  },
  {
    fixtureId: "nested-revision-protected-title",
    name: "metadata_leakage",
    expected: "metadata_leakage",
    expectedDisposition: "reject",
    check: {
      kind: "metadata_leakage",
      manifest: protocolFixtureManifest,
      hostedRecord: {
        opaqueRevision: {
          ...protocolFixtureObject.opaqueRevision,
          title: "synthetic nested protected title",
        },
      },
    },
  },
  {
    fixtureId: "nested-disclosure-protected-prompt",
    name: "metadata_leakage",
    expected: "metadata_leakage",
    expectedDisposition: "reject",
    check: {
      kind: "metadata_leakage",
      manifest: protocolFixtureManifest,
      hostedRecord: {
        disclosureEnvelope: {
          version: 1,
          disclosureId: "disclosure:fixture-01",
          vaultId: "vault:fixture-01",
          grantId: "grant:fixture-01",
          identityId: "identity:fixture-owner",
          endpointId: "endpoint:fixture-recipient",
          agentId: "agent:fixture-01",
          resources: [
            { resourceType: "document", resourceId: "object:fixture-01" },
          ],
          operation: "summarize",
          provider: {
            providerId: "provider:fixture-01",
            destinationId: "destination:fixture-01",
          },
          occurredAt: now,
          outcome: "allowed",
          sequence: 1,
          previousDigest: null,
          envelopeDigest: "digest:fixture-01",
          prompt: "synthetic nested protected prompt",
        },
      },
    },
  },
] as const;
