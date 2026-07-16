import { describe, expect, it } from "vitest";

import {
  protocolFixtureManifest,
  protocolFixtureObject,
} from "./failure-fixtures.js";
import {
  assertHostedFieldsAllowed,
  HostedFieldViolationError,
  HostedFieldValueViolationError,
  PERSONAL_VAULT_V1_HOSTED_FIELDS,
  PERSONAL_VAULT_V1_METADATA_BUDGET,
  PERSONAL_VAULT_V1_RETENTION,
  resourcePrivacyManifestSchema,
} from "./privacy-manifest.js";

describe("resource privacy manifest", () => {
  it("freezes protected fields, hosted metadata, placement, egress, and deletion", () => {
    const manifest = resourcePrivacyManifestSchema.parse(
      protocolFixtureManifest,
    );
    expect(manifest.protectedFields).toContain("searchIndex");
    expect(manifest.executionPlacement).toBe("trusted_endpoint");
    expect(manifest.egress.default).toBe("deny");
    expect(manifest.admittedLeakage).toContain("opaque_access_patterns");
    expect(manifest.retention.map((rule) => rule.deletionTrigger)).toContain(
      "resource_deleted",
    );
  });

  it("rejects retention rules for fields outside the hosted allowlist", () => {
    expect(
      resourcePrivacyManifestSchema.safeParse({
        ...protocolFixtureManifest,
        retention: [
          {
            ...protocolFixtureManifest.retention[0],
            fields: ["accessEvent"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires exactly one retention/deletion rule for every hosted field", () => {
    expect(
      resourcePrivacyManifestSchema.safeParse({
        ...protocolFixtureManifest,
        retention: protocolFixtureManifest.retention.slice(1),
      }).success,
    ).toBe(false);
    expect(
      resourcePrivacyManifestSchema.safeParse({
        ...protocolFixtureManifest,
        retention: [
          ...protocolFixtureManifest.retention,
          protocolFixtureManifest.retention[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      resourcePrivacyManifestSchema.safeParse({
        ...protocolFixtureManifest,
        hostedFields: [
          ...protocolFixtureManifest.hostedFields,
          protocolFixtureManifest.hostedFields[0],
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects protected hosted fields outside the manifest", () => {
    const hostedRecord = {
      version: protocolFixtureObject.version,
      accountId: protocolFixtureObject.accountId,
      workspaceId: protocolFixtureObject.workspaceId,
      vaultId: protocolFixtureObject.vaultId,
      objectId: protocolFixtureObject.objectId,
      objectType: protocolFixtureObject.objectType,
      keyEpoch: protocolFixtureObject.opaqueRevision.epoch,
      algorithmId: protocolFixtureObject.algorithmId,
      ciphertext: protocolFixtureObject.ciphertext,
      ciphertextByteLength:
        protocolFixtureObject.opaqueRevision.ciphertextByteLength,
      opaqueRevision: protocolFixtureObject.opaqueRevision,
      serverReceivedAt: protocolFixtureObject.opaqueRevision.serverReceivedAt,
    };
    expect(() =>
      assertHostedFieldsAllowed(protocolFixtureManifest, hostedRecord),
    ).not.toThrow();
    expect(() =>
      assertHostedFieldsAllowed(protocolFixtureManifest, {
        ...hostedRecord,
        title: "synthetic protected title",
        snippet: "synthetic protected snippet",
      }),
    ).toThrowError(HostedFieldViolationError);
  });

  it("exports an exact, valid v1 retention table", () => {
    const manifest = {
      ...protocolFixtureManifest,
      hostedFields: Array.from(
        new Set(PERSONAL_VAULT_V1_RETENTION.flatMap((rule) => rule.fields)),
      ),
      retention: PERSONAL_VAULT_V1_RETENTION,
    };
    expect(
      resourcePrivacyManifestSchema.parse(manifest).retention,
    ).toHaveLength(5);
  });

  it("strictly validates admitted nested containers without inspecting ciphertext", () => {
    expect(() =>
      assertHostedFieldsAllowed(protocolFixtureManifest, {
        opaqueRevision: {
          ...protocolFixtureObject.opaqueRevision,
          title: "synthetic nested protected title",
        },
      }),
    ).toThrowError(HostedFieldValueViolationError);
    expect(() =>
      assertHostedFieldsAllowed(protocolFixtureManifest, {
        ciphertext: JSON.stringify({
          title: "opaque ciphertext may resemble JSON and remains opaque",
        }),
      }),
    ).not.toThrow();
  });

  it("freezes the exact M2 hosted-field and retention/deletion budget", () => {
    expect(PERSONAL_VAULT_V1_HOSTED_FIELDS).toEqual([
      "version",
      "accountId",
      "workspaceId",
      "vaultId",
      "vaultState",
      "objectId",
      "objectType",
      "objectState",
      "endpointId",
      "endpointState",
      "endpointPublicIdentity",
      "jobId",
      "jobHash",
      "grantId",
      "keyEpoch",
      "keyEpochState",
      "wrappedKeyEnvelope",
      "algorithmId",
      "ciphertext",
      "ciphertextByteLength",
      "opaqueRevision",
      "serverReceivedAt",
      "issuedAt",
      "expiresAt",
      "jobState",
      "leaseExpiresAt",
      "retryAt",
      "retryCount",
      "healthState",
      "accessEvent",
      "disclosureEnvelope",
    ]);
    expect(
      PERSONAL_VAULT_V1_RETENTION.map((rule) => ({
        fields: rule.fields,
        live: rule.liveRetention,
        days: rule.liveRetentionDays,
        trigger: rule.deletionTrigger,
        activePurge: rule.activePurgeWithinDays,
        backupPurge: rule.backupPurgeWithinDays,
      })),
    ).toEqual([
      {
        fields: [
          "version",
          "accountId",
          "workspaceId",
          "vaultId",
          "vaultState",
        ],
        live: "while_vault_exists",
        days: null,
        trigger: "vault_deleted",
        activePurge: 30,
        backupPurge: 35,
      },
      {
        fields: [
          "objectId",
          "objectType",
          "objectState",
          "keyEpoch",
          "keyEpochState",
          "wrappedKeyEnvelope",
          "algorithmId",
          "ciphertext",
          "ciphertextByteLength",
          "opaqueRevision",
          "serverReceivedAt",
        ],
        live: "while_resource_exists",
        days: null,
        trigger: "resource_deleted",
        activePurge: 30,
        backupPurge: 35,
      },
      {
        fields: [
          "endpointId",
          "endpointState",
          "endpointPublicIdentity",
          "healthState",
        ],
        live: "while_endpoint_enrolled",
        days: null,
        trigger: "endpoint_removed",
        activePurge: 30,
        backupPurge: 35,
      },
      {
        fields: [
          "jobId",
          "jobHash",
          "grantId",
          "issuedAt",
          "expiresAt",
          "jobState",
          "leaseExpiresAt",
          "retryAt",
          "retryCount",
        ],
        live: "until_job_terminal",
        days: null,
        trigger: "job_terminal",
        activePurge: 30,
        backupPurge: 35,
      },
      {
        fields: ["accessEvent", "disclosureEnvelope"],
        live: "fixed_days",
        days: 90,
        trigger: "retention_elapsed",
        activePurge: 7,
        backupPurge: 35,
      },
    ]);
    expect(PERSONAL_VAULT_V1_METADATA_BUDGET.hostedFields).toBe(
      PERSONAL_VAULT_V1_HOSTED_FIELDS,
    );
  });
});
