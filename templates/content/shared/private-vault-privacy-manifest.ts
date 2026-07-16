import {
  PERSONAL_VAULT_V1_ADMITTED_LEAKAGE,
  PERSONAL_VAULT_V1_HOSTED_FIELDS,
  PERSONAL_VAULT_V1_RETENTION,
  resourcePrivacyManifestSchema,
} from "@agent-native/core/e2ee";

/**
 * Content Private Vault beta protects the complete document plaintext and every
 * server-readable derivative identified by the F3 inventory. These are policy
 * names, not hosted column names: protected objects may persist only the M2
 * hosted-field allowlist below.
 */
export const CONTENT_PRIVATE_VAULT_V1_PROTECTED_FIELDS = [
  "document.title",
  "document.body",
  "document.icon",
  "document.hierarchy",
  "document.sourcePath",
  "document.version",
  "comment.body",
  "comment.quote",
  "comment.anchor",
  "comment.mention",
  "database.definition",
  "database.view",
  "database.field",
  "database.row",
  "database.propertyValue",
  "database.block",
  "source.changeSet",
  "source.review",
  "source.execution",
  "source.hydrationPayload",
  "search.index",
  "search.snippet",
  "collaboration.update",
  "collaboration.snapshot",
  "collaboration.awareness",
  "applicationState.protectedContext",
  "chat.title",
  "chat.preview",
  "chat.transcript",
  "agentRun.input",
  "agentRun.event",
  "agentRun.result",
  "dispatch.payload",
  "toolLedger.arguments",
  "toolLedger.result",
  "audit.protectedInput",
  "audit.protectedSummary",
  "trace.protectedPayload",
  "analytics.protectedProperty",
  "log.protectedPayload",
  "a2a.message",
  "a2a.artifact",
  "a2a.approvalPayload",
  "integration.continuationPayload",
  "automation.prompt",
  "automation.result",
  "notification.title",
  "notification.body",
  "notification.metadata",
  "media.bytes",
  "media.derivedArtifact",
  "export.payload",
  "import.payload",
  "provider.requestPayload",
  "provider.responsePayload",
  "model.prompt",
  "model.result",
] as const;

export const CONTENT_PRIVATE_VAULT_V1_FAIL_CLOSED_FEATURES = [
  "comments",
  "databases",
  "collaboration",
  "public-publishing",
  "sharing",
  "notion-sync",
  "builder-sync",
  "source-federation",
  "extensions",
  "webhooks",
  "provider-api",
  "transcription",
  "media",
  "local-file-mode",
  "plaintext-export",
  "plaintext-import",
] as const;

/**
 * Physical tenant-routing columns required by the existing authenticated SQL
 * boundary. They are aliases of already-admitted account/workspace identity,
 * not additional logical protected-record fields, and must be removed before
 * hosted-record validation or serialization.
 */
export const CONTENT_PRIVATE_VAULT_V1_AUTH_ROUTING_ALIASES = {
  ownerEmail: "accountId",
  orgId: "workspaceId",
} as const;

/** Exact M1/M2 policy for a Content Private Vault document. */
export const CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST =
  resourcePrivacyManifestSchema.parse({
    version: 1,
    resourceType: "content_private_vault_document",
    protectedFields: CONTENT_PRIVATE_VAULT_V1_PROTECTED_FIELDS,
    hostedFields: PERSONAL_VAULT_V1_HOSTED_FIELDS,
    executionPlacement: "enrolled_broker",
    egress: {
      default: "deny",
      requiresCapabilityGrant: true,
      providerBound: true,
      destinationBound: true,
    },
    admittedLeakage: PERSONAL_VAULT_V1_ADMITTED_LEAKAGE,
    retention: PERSONAL_VAULT_V1_RETENTION,
    failClosedFeatures: CONTENT_PRIVATE_VAULT_V1_FAIL_CLOSED_FEATURES,
  });
