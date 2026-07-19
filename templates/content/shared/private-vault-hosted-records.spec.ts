import {
  E2EE_SIZE_LIMITS,
  KNOWN_PLAINTEXT_SENTINEL,
} from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import {
  validatePrivateVaultAccessEventRow,
  validatePrivateVaultDisclosureRow,
  validatePrivateVaultEndpointRow,
  validatePrivateVaultGrantRow,
  validatePrivateVaultJobResultRow,
  validatePrivateVaultJobRow,
  validatePrivateVaultKeyEnvelopeRow,
  validatePrivateVaultKeyEpochRow,
  validatePrivateVaultObjectRow,
  validatePrivateVaultRevisionRow,
  validatePrivateVaultRow,
  validatePrivateVaultSyncEventRow,
} from "./private-vault-hosted-records";

const at = "2026-07-16T12:00:00.000Z";
const later = "2026-07-16T13:00:00.000Z";
const scope = { ownerEmail: "owner@example.test", orgId: "" };
const ids = {
  vaultId: "vault_fixture_01",
  objectId: "object_fixture_01",
  revisionId: "revision_fixture_01",
  endpointId: "endpoint_fixture_01",
  grantId: "grant_fixture_01",
  jobId: "job_fixture_01",
};
const opaqueRevision = {
  version: 1 as const,
  vaultId: ids.vaultId,
  objectId: ids.objectId,
  revisionId: ids.revisionId,
  revision: 1,
  parentRevisionIds: [],
  epoch: 1,
  ciphertextByteLength: 42,
  serverReceivedAt: at,
};

describe("Content Private Vault hosted-record boundary", () => {
  it("strips physical auth aliases before exact M2 hosted validation", () => {
    const validated = validatePrivateVaultRow({
      ...scope,
      version: 1,
      accountId: "account_fixture_01",
      workspaceId: "workspace_fixture_01",
      vaultId: ids.vaultId,
      vaultState: "active",
      serverReceivedAt: at,
    });

    expect(validated.scope).toEqual(scope);
    expect(validated.logical).toEqual({
      version: 1,
      accountId: "account_fixture_01",
      workspaceId: "workspace_fixture_01",
      vaultId: ids.vaultId,
      vaultState: "active",
      serverReceivedAt: at,
    });
    expect(validated.logical).not.toHaveProperty("ownerEmail");
    expect(validated.logical).not.toHaveProperty("orgId");
  });

  it("validates each opaque hosted row without admitting ciphertext bodies or handles", () => {
    const publicIdentity = JSON.stringify({
      algorithmId: "anc/v1",
      publicIdentity: "opaque-public-key",
    });
    expect(
      validatePrivateVaultEndpointRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        endpointId: ids.endpointId,
        endpointState: "online",
        publicIdentityJson: publicIdentity,
        healthState: "healthy",
        serverReceivedAt: at,
      }).logical,
    ).toHaveProperty("endpointPublicIdentity");

    expect(
      validatePrivateVaultKeyEpochRow({
        ...scope,
        version: 1,
        id: `${ids.vaultId}:1`,
        vaultId: ids.vaultId,
        epoch: 1,
        state: "active",
        serverReceivedAt: at,
      }).logical,
    ).toMatchObject({ keyEpoch: 1, keyEpochState: "active" });

    expect(
      validatePrivateVaultKeyEnvelopeRow({
        ...scope,
        version: 1,
        envelopeId: "envelope_fixture_01",
        vaultId: ids.vaultId,
        epoch: 1,
        senderEndpointId: "endpoint_sender_01",
        recipientEndpointId: ids.endpointId,
        algorithmId: "anc/v1",
        ciphertextByteLength: 128,
        expiresAt: later,
        serverReceivedAt: at,
      }).logical,
    ).not.toHaveProperty("wrappedKey");

    expect(
      validatePrivateVaultGrantRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        grantId: ids.grantId,
        recipientEndpointId: ids.endpointId,
        algorithmId: "anc/v1",
        ciphertextByteLength: 256,
        issuedAt: at,
        expiresAt: later,
        serverReceivedAt: at,
      }).logical,
    ).not.toHaveProperty("ciphertext");

    expect(
      validatePrivateVaultObjectRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        objectId: ids.objectId,
        objectType: "document",
        objectState: "active",
        serverReceivedAt: at,
      }).logical,
    ).toMatchObject({ objectId: ids.objectId, objectType: "document" });

    expect(
      validatePrivateVaultRevisionRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        objectId: ids.objectId,
        revisionId: ids.revisionId,
        epoch: 1,
        algorithmId: "anc/v1",
        ciphertextByteLength: 42,
        opaqueRevisionJson: JSON.stringify(opaqueRevision),
        serverReceivedAt: at,
      }).logical,
    ).not.toHaveProperty("opaqueRevisionJson");

    expect(
      validatePrivateVaultSyncEventRow({
        ...scope,
        version: 1,
        eventId: "event_fixture_01",
        vaultId: ids.vaultId,
        objectId: ids.objectId,
        eventType: "object.updated",
        opaqueRevisionJson: JSON.stringify(opaqueRevision),
        serverReceivedAt: at,
      }).logical,
    ).toMatchObject({ objectType: "object.updated" });

    expect(
      validatePrivateVaultJobRow({
        ...scope,
        version: 1,
        jobId: ids.jobId,
        vaultId: ids.vaultId,
        grantId: ids.grantId,
        recipientEndpointId: ids.endpointId,
        epoch: 1,
        algorithmId: "anc/v1",
        ciphertextByteLength: 512,
        issuedAt: at,
        expiresAt: later,
        jobState: "queued",
        retryCount: 0,
        retryAt: null,
        leaseExpiresAt: null,
        serverReceivedAt: at,
      }).logical,
    ).not.toHaveProperty("request");

    expect(
      validatePrivateVaultJobResultRow({
        ...scope,
        version: 1,
        jobId: ids.jobId,
        vaultId: ids.vaultId,
        endpointId: ids.endpointId,
        epoch: 1,
        jobHash: "job_hash_fixture_01",
        algorithmId: "anc/v1",
        ciphertextByteLength: 256,
        jobState: "completed",
        serverReceivedAt: at,
      }).logical,
    ).not.toHaveProperty("result");
  });

  it("accepts only exact, strict content-free disclosure and access JSON", () => {
    const disclosure = {
      version: 1 as const,
      disclosureId: "disclosure_fixture_01",
      vaultId: ids.vaultId,
      grantId: ids.grantId,
      identityId: "identity_fixture_01",
      endpointId: ids.endpointId,
      agentId: null,
      resources: [{ resourceType: "document", resourceId: ids.objectId }],
      operation: "read",
      provider: null,
      occurredAt: at,
      outcome: "allowed" as const,
      sequence: 1,
      previousDigest: null,
      envelopeDigest: "digest_fixture_01",
    };
    expect(
      validatePrivateVaultDisclosureRow({
        ...scope,
        version: 1,
        disclosureId: disclosure.disclosureId,
        vaultId: ids.vaultId,
        grantId: ids.grantId,
        endpointId: ids.endpointId,
        disclosureEnvelopeJson: JSON.stringify(disclosure),
        serverReceivedAt: at,
      }).logical,
    ).toHaveProperty("disclosureEnvelope", disclosure);

    const accessEvent = {
      version: 1 as const,
      accessEventId: "access_event_fixture_01",
      vaultId: ids.vaultId,
      identityId: "identity_fixture_01",
      endpointId: ids.endpointId,
      resource: { resourceType: "document", resourceId: ids.objectId },
      operation: "read",
      occurredAt: at,
      outcome: "allowed" as const,
    };
    expect(
      validatePrivateVaultAccessEventRow({
        ...scope,
        version: 1,
        accessEventId: accessEvent.accessEventId,
        vaultId: ids.vaultId,
        accessEventJson: JSON.stringify(accessEvent),
        serverReceivedAt: at,
      }).logical,
    ).toHaveProperty("accessEvent", accessEvent);

    expect(() =>
      validatePrivateVaultAccessEventRow({
        ...scope,
        version: 1,
        accessEventId: accessEvent.accessEventId,
        vaultId: ids.vaultId,
        accessEventJson: JSON.stringify(accessEvent, null, 2),
        serverReceivedAt: at,
      }),
    ).toThrow(/exact canonical JSON round trip/);
  });

  it("rejects plaintext fields, alias smuggling, malformed bounds, and cross-binding", () => {
    expect(() =>
      validatePrivateVaultObjectRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        objectId: ids.objectId,
        objectType: "document",
        objectState: "active",
        serverReceivedAt: at,
        title: KNOWN_PLAINTEXT_SENTINEL,
      }),
    ).toThrow();

    expect(() =>
      validatePrivateVaultRow({
        ...scope,
        version: 1,
        accountId: "account_fixture_01",
        workspaceId: "workspace_fixture_01",
        vaultId: ids.vaultId,
        vaultState: "active",
        serverReceivedAt: at,
        visibility: "public",
      }),
    ).toThrow();

    expect(() =>
      validatePrivateVaultGrantRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        grantId: ids.grantId,
        recipientEndpointId: ids.endpointId,
        algorithmId: "anc/v1",
        ciphertextByteLength: E2EE_SIZE_LIMITS.controlEnvelopeBytes + 1,
        issuedAt: at,
        expiresAt: later,
        serverReceivedAt: at,
      }),
    ).toThrow();

    expect(() =>
      validatePrivateVaultRevisionRow({
        ...scope,
        version: 1,
        vaultId: ids.vaultId,
        objectId: ids.objectId,
        revisionId: ids.revisionId,
        epoch: 1,
        algorithmId: "anc/v1",
        ciphertextByteLength: 42,
        opaqueRevisionJson: JSON.stringify({
          ...opaqueRevision,
          objectId: "object_foreign_01",
        }),
        serverReceivedAt: at,
      }),
    ).toThrow(/does not match/);

    expect(() =>
      validatePrivateVaultJobRow({
        ...scope,
        version: 1,
        jobId: ids.jobId,
        vaultId: ids.vaultId,
        grantId: ids.grantId,
        recipientEndpointId: ids.endpointId,
        epoch: 1,
        algorithmId: "anc/v1",
        ciphertextByteLength: 1,
        issuedAt: at,
        expiresAt: later,
        jobState: "queued",
        retryCount: 0,
        retryAt: null,
        leaseExpiresAt: later,
        serverReceivedAt: at,
      }),
    ).toThrow(/Only leased jobs/);
  });
});
