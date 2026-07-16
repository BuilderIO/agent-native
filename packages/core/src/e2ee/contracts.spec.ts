import { describe, expect, it } from "vitest";

import {
  capabilityGrantSchema,
  ciphertextObjectSchema,
  disclosureEnvelopeSchema,
  encryptedJobResultSchema,
  encryptedQueuedJobSchema,
  encryptionDomainSchema,
  endpointIdentitySchema,
  endpointStatusSchema,
  keyEpochSchema,
  opaqueRevisionSchema,
  wrappedKeyEnvelopeSchema,
} from "./contracts.js";
import {
  protocolFixtureEnvelope,
  protocolFixtureObject,
} from "./failure-fixtures.js";

const now = "2026-07-16T12:00:00.000Z";

describe("E2EE wire contracts", () => {
  it("accepts a personal-vault domain and rejects unknown fields", () => {
    const domain = {
      version: 1,
      kind: "personal_vault",
      vaultId: "vault:fixture-01",
      ownerIdentityId: "identity:fixture-owner",
      accountId: "account:fixture-01",
      workspaceId: "workspace:fixture-01",
      createdAt: now,
      state: "active",
    };
    expect(encryptionDomainSchema.parse(domain)).toEqual(domain);
    expect(
      encryptionDomainSchema.safeParse({ ...domain, title: "not hosted" })
        .success,
    ).toBe(false);
  });

  it("accepts endpoint identity/status, key epoch, and a wrapped envelope", () => {
    expect(
      endpointIdentitySchema.parse({
        version: 1,
        endpointId: "endpoint:fixture-01",
        vaultId: "vault:fixture-01",
        identityId: "identity:fixture-owner",
        kind: "desktop",
        publicIdentity: {
          algorithmId: "opaque.identity.fixture-v1",
          publicIdentity: "opaque-public-identity-fixture",
        },
        softwareIdentity: {
          product: "Agent Native Desktop",
          version: "fixture-v1",
          buildId: "build:fixture-01",
        },
        enrolledAt: now,
      }).endpointId,
    ).toBe("endpoint:fixture-01");
    expect(
      endpointStatusSchema.parse({
        version: 1,
        endpointId: "endpoint:fixture-01",
        vaultId: "vault:fixture-01",
        state: "online",
        serverReceivedAt: now,
        lastIntegrityAt: null,
      }).state,
    ).toBe("online");
    expect(
      keyEpochSchema.parse({
        version: 1,
        vaultId: "vault:fixture-01",
        epoch: 2,
        state: "active",
        serverReceivedAt: now,
      }).epoch,
    ).toBe(2);
    expect(
      wrappedKeyEnvelopeSchema.parse(protocolFixtureEnvelope),
    ).toBeTruthy();
  });

  it("requires identity, resource, operation, provider, and expiry bounds", () => {
    const grant = {
      version: 1,
      grantId: "grant:fixture-01",
      vaultId: "vault:fixture-01",
      issuerIdentityId: "identity:fixture-owner",
      subject: {
        identityId: "identity:fixture-owner",
        endpointId: "endpoint:fixture-01",
        agentId: "agent:fixture-01",
      },
      resources: [
        { resourceType: "document", resourceId: "object:fixture-01" },
      ],
      operations: ["read"],
      providers: [
        {
          providerId: "provider:fixture-01",
          destinationId: "destination:fixture-01",
        },
      ],
      issuedAt: now,
      expiresAt: "2026-07-16T13:00:00.000Z",
      revokedAt: null,
    };
    expect(capabilityGrantSchema.parse(grant)).toEqual(grant);
    expect(
      capabilityGrantSchema.safeParse({ ...grant, providers: [] }).success,
    ).toBe(false);
    expect(
      capabilityGrantSchema.safeParse({ ...grant, expiresAt: now }).success,
    ).toBe(false);
    expect(
      capabilityGrantSchema.safeParse({
        ...grant,
        resources: [grant.resources[0], grant.resources[0]],
      }).success,
    ).toBe(false);
    expect(
      capabilityGrantSchema.safeParse({
        ...grant,
        operations: ["read", "read"],
      }).success,
    ).toBe(false);
    expect(
      capabilityGrantSchema.safeParse({
        ...grant,
        providers: [grant.providers[0], grant.providers[0]],
      }).success,
    ).toBe(false);
  });

  it("keeps disclosures content-free by strict schema", () => {
    const disclosure = {
      version: 1,
      disclosureId: "disclosure:fixture-01",
      vaultId: "vault:fixture-01",
      grantId: "grant:fixture-01",
      identityId: "identity:fixture-owner",
      endpointId: "endpoint:fixture-01",
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
    };
    expect(disclosureEnvelopeSchema.parse(disclosure)).toEqual(disclosure);
    expect(
      disclosureEnvelopeSchema.safeParse({
        ...disclosure,
        prompt: "protected fixture prompt",
      }).success,
    ).toBe(false);
  });

  it("validates opaque revisions, ciphertext, jobs, and encrypted results", () => {
    expect(
      opaqueRevisionSchema.parse(protocolFixtureObject.opaqueRevision),
    ).toBeTruthy();
    expect(ciphertextObjectSchema.parse(protocolFixtureObject)).toBeTruthy();
    expect(
      ciphertextObjectSchema.safeParse({
        ...protocolFixtureObject,
        opaqueRevision: {
          ...protocolFixtureObject.opaqueRevision,
          objectId: "object:other-01",
        },
      }).success,
    ).toBe(false);

    const request = {
      algorithmId: "opaque.algorithm.fixture-v1",
      ciphertext: "opaque-job-request-fixture",
      ciphertextByteLength: 26,
    };
    expect(
      encryptedQueuedJobSchema.parse({
        version: 1,
        jobId: "job:fixture-01",
        vaultId: "vault:fixture-01",
        grantId: "grant:fixture-01",
        recipientEndpointId: "endpoint:fixture-01",
        epoch: 2,
        request,
        issuedAt: now,
        expiresAt: "2026-07-16T13:00:00.000Z",
        state: "queued",
        serverReceivedAt: now,
        leaseExpiresAt: null,
        retryAt: null,
        retryCount: 0,
      }).state,
    ).toBe("queued");
    expect(
      encryptedJobResultSchema.parse({
        version: 1,
        jobId: "job:fixture-01",
        vaultId: "vault:fixture-01",
        recipientEndpointId: "endpoint:fixture-01",
        epoch: 2,
        jobHash: "digest:job-fixture-01",
        result: request,
        state: "completed",
        serverReceivedAt: now,
      }).state,
    ).toBe("completed");
    expect(
      encryptedQueuedJobSchema.safeParse({
        version: 1,
        jobId: "job:fixture-01",
        vaultId: "vault:fixture-01",
        grantId: "grant:fixture-01",
        recipientEndpointId: "endpoint:fixture-01",
        epoch: 2,
        request,
        issuedAt: now,
        expiresAt: now,
        state: "queued",
        serverReceivedAt: now,
        leaseExpiresAt: null,
        retryAt: null,
        retryCount: 0,
      }).success,
    ).toBe(false);
    expect(
      encryptedQueuedJobSchema.safeParse({
        version: 1,
        jobId: "job:fixture-01",
        vaultId: "vault:fixture-01",
        grantId: "grant:fixture-01",
        recipientEndpointId: "endpoint:fixture-01",
        epoch: 2,
        request,
        issuedAt: now,
        expiresAt: "2026-07-16T13:00:00.000Z",
        state: "queued",
        serverReceivedAt: now,
        leaseExpiresAt: null,
        retryAt: "2026-07-16T12:01:00.000Z",
        retryCount: 1,
      }).success,
    ).toBe(false);
  });

  it("keeps algorithm identifiers opaque and rejects embedded algorithm objects", () => {
    expect(
      wrappedKeyEnvelopeSchema.safeParse({
        ...protocolFixtureEnvelope,
        algorithmId: "future.vendor-suite/v99",
      }).success,
    ).toBe(true);
    expect(
      wrappedKeyEnvelopeSchema.safeParse({
        ...protocolFixtureEnvelope,
        algorithmId: { cipher: "fixture" },
      }).success,
    ).toBe(false);
  });
});
