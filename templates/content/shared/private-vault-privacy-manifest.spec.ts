import {
  assertHostedFieldsAllowed,
  HostedFieldViolationError,
  PERSONAL_VAULT_V1_HOSTED_FIELDS,
  resourcePrivacyManifestSchema,
} from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import {
  CONTENT_PRIVATE_VAULT_V1_AUTH_ROUTING_ALIASES,
  CONTENT_PRIVATE_VAULT_V1_FAIL_CLOSED_FEATURES,
  CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST,
  CONTENT_PRIVATE_VAULT_V1_PROTECTED_FIELDS,
} from "./private-vault-privacy-manifest";

describe("Content Private Vault privacy manifest", () => {
  it("freezes the M1 domain, M2 budget, broker placement, and deny-by-default egress", () => {
    const manifest = resourcePrivacyManifestSchema.parse(
      CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST,
    );
    expect(manifest.resourceType).toBe("content_private_vault_document");
    expect(manifest.hostedFields).toEqual(PERSONAL_VAULT_V1_HOSTED_FIELDS);
    expect(manifest.executionPlacement).toBe("enrolled_broker");
    expect(manifest.egress).toEqual({
      default: "deny",
      requiresCapabilityGrant: true,
      providerBound: true,
      destinationBound: true,
    });
  });

  it("maps physical auth scope columns only to admitted account/workspace identity", () => {
    expect(CONTENT_PRIVATE_VAULT_V1_AUTH_ROUTING_ALIASES).toEqual({
      ownerEmail: "accountId",
      orgId: "workspaceId",
    });
    expect(PERSONAL_VAULT_V1_HOSTED_FIELDS).not.toContain("ownerEmail");
    expect(PERSONAL_VAULT_V1_HOSTED_FIELDS).not.toContain("orgId");
  });

  it("classifies every F3 plaintext domain as protected", () => {
    expect(CONTENT_PRIVATE_VAULT_V1_PROTECTED_FIELDS).toEqual(
      expect.arrayContaining([
        "document.title",
        "document.body",
        "collaboration.snapshot",
        "chat.transcript",
        "agentRun.event",
        "toolLedger.result",
        "audit.protectedInput",
        "a2a.message",
        "automation.prompt",
        "media.bytes",
        "provider.requestPayload",
        "model.result",
      ]),
    );
  });

  it("fails unsupported beta features closed instead of falling back to plaintext", () => {
    expect(CONTENT_PRIVATE_VAULT_V1_FAIL_CLOSED_FEATURES).toEqual(
      expect.arrayContaining([
        "comments",
        "databases",
        "collaboration",
        "public-publishing",
        "notion-sync",
        "extensions",
        "media",
        "plaintext-export",
      ]),
    );
  });

  it("rejects protected plaintext from hosted records", () => {
    expect(() =>
      assertHostedFieldsAllowed(CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST, {
        version: 1,
        accountId: "acct_fixture_01",
        workspaceId: "workspace_fixture_01",
        vaultId: "vault_fixture_01",
        objectId: "object_fixture_01",
        objectType: "document",
        algorithmId: "pending-m3-fixture",
        ciphertext: "opaque-fixture-ciphertext",
        ciphertextByteLength: 25,
        keyEpoch: 1,
        opaqueRevision: {
          revisionId: "revision_fixture_01",
          parentRevisionId: null,
          epoch: 1,
          ciphertextByteLength: 25,
          serverReceivedAt: "2026-07-16T00:00:00.000Z",
        },
        serverReceivedAt: "2026-07-16T00:00:00.000Z",
        title: "synthetic protected title",
      }),
    ).toThrowError(HostedFieldViolationError);
  });
});
