import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { discoverAgents } from "@agent-native/core/server/agent-discovery";
import { getDb, schema } from "../db/index.js";
import {
  currentOwnerEmail,
  currentOrgId,
  recordAudit,
} from "./dispatcher-store.js";

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function orgFilter<T extends { ownerEmail: any; orgId: any }>(table: T) {
  const orgId = currentOrgId();
  return and(
    eq(table.ownerEmail, currentOwnerEmail()),
    orgId ? eq(table.orgId, orgId) : isNull(table.orgId),
  );
}

// ─── Vault Audit ──────────────────────────────────────────────────

export async function recordVaultAudit(input: {
  action: string;
  secretId?: string | null;
  appId?: string | null;
  summary: string;
  metadata?: unknown;
  actor?: string;
}) {
  const db = getDb();
  await db.insert(schema.vaultAuditLog).values({
    id: id(),
    ownerEmail: currentOwnerEmail(),
    orgId: currentOrgId(),
    secretId: input.secretId || null,
    appId: input.appId || null,
    action: input.action,
    actor: input.actor || currentOwnerEmail(),
    summary: input.summary,
    metadata: input.metadata ? safeJson(input.metadata) : null,
    createdAt: now(),
  });
}

export async function listVaultAudit(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(schema.vaultAuditLog)
    .where(orgFilter(schema.vaultAuditLog))
    .orderBy(desc(schema.vaultAuditLog.createdAt))
    .limit(limit);
}

// ─── Secrets ──────────────────────────────────────────────────────

export async function listSecrets() {
  const db = getDb();
  return db
    .select()
    .from(schema.vaultSecrets)
    .where(orgFilter(schema.vaultSecrets))
    .orderBy(desc(schema.vaultSecrets.updatedAt));
}

export async function getSecret(secretId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultSecrets)
    .where(eq(schema.vaultSecrets.id, secretId))
    .limit(1);
  return row ?? null;
}

export async function createSecret(input: {
  credentialKey: string;
  value: string;
  name: string;
  provider?: string | null;
  description?: string | null;
}) {
  const db = getDb();
  const timestamp = now();
  const secretId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.vaultSecrets).values({
    id: secretId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    name: input.name,
    credentialKey: input.credentialKey,
    value: input.value,
    provider: input.provider || null,
    description: input.description || null,
    createdBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "secret.created",
    secretId,
    summary: `Created secret "${input.name}" (${input.credentialKey})`,
    metadata: { credentialKey: input.credentialKey, provider: input.provider },
  });

  await recordAudit({
    action: "vault.secret.created",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Created vault secret "${input.name}" (${input.credentialKey})`,
  });

  return getSecret(secretId);
}

export async function updateSecret(secretId: string, value: string) {
  const db = getDb();
  const existing = await getSecret(secretId);
  if (!existing) throw new Error("Secret not found");

  await db
    .update(schema.vaultSecrets)
    .set({ value, updatedAt: now() })
    .where(eq(schema.vaultSecrets.id, secretId));

  await recordVaultAudit({
    action: "secret.updated",
    secretId,
    summary: `Updated value for secret "${existing.name}" (${existing.credentialKey})`,
  });

  return getSecret(secretId);
}

export async function deleteSecret(secretId: string) {
  const db = getDb();
  const existing = await getSecret(secretId);
  if (!existing) throw new Error("Secret not found");

  // Revoke all active grants first
  const grants = await listGrants({ secretId });
  for (const grant of grants) {
    if (grant.status === "active") {
      await revokeGrant(grant.id);
    }
  }

  await db
    .delete(schema.vaultSecrets)
    .where(eq(schema.vaultSecrets.id, secretId));

  await recordVaultAudit({
    action: "secret.deleted",
    secretId,
    summary: `Deleted secret "${existing.name}" (${existing.credentialKey})`,
  });

  await recordAudit({
    action: "vault.secret.deleted",
    targetType: "vault-secret",
    targetId: secretId,
    summary: `Deleted vault secret "${existing.name}" (${existing.credentialKey})`,
  });

  return existing;
}

// ─── Grants ──────────────────────────────────────────────────────

export async function listGrants(filter?: {
  secretId?: string;
  appId?: string;
}) {
  const db = getDb();
  const conditions = [orgFilter(schema.vaultGrants)];
  if (filter?.secretId) {
    conditions.push(eq(schema.vaultGrants.secretId, filter.secretId) as any);
  }
  if (filter?.appId) {
    conditions.push(eq(schema.vaultGrants.appId, filter.appId) as any);
  }
  return db
    .select()
    .from(schema.vaultGrants)
    .where(and(...conditions))
    .orderBy(desc(schema.vaultGrants.updatedAt));
}

export async function getGrant(grantId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultGrants)
    .where(eq(schema.vaultGrants.id, grantId))
    .limit(1);
  return row ?? null;
}

export async function createGrant(secretId: string, appId: string) {
  const db = getDb();
  const secret = await getSecret(secretId);
  if (!secret) throw new Error("Secret not found");

  const timestamp = now();
  const grantId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.vaultGrants).values({
    id: grantId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    secretId,
    appId,
    grantedBy: actor,
    status: "active",
    syncedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "grant.created",
    secretId,
    appId,
    summary: `Granted "${secret.name}" (${secret.credentialKey}) to ${appId}`,
    metadata: { grantId },
  });

  await recordAudit({
    action: "vault.grant.created",
    targetType: "vault-grant",
    targetId: grantId,
    summary: `Granted vault secret "${secret.name}" to ${appId}`,
  });

  return getGrant(grantId);
}

export async function revokeGrant(grantId: string) {
  const db = getDb();
  const grant = await getGrant(grantId);
  if (!grant) throw new Error("Grant not found");

  const secret = await getSecret(grant.secretId);

  await db
    .update(schema.vaultGrants)
    .set({ status: "revoked", updatedAt: now() })
    .where(eq(schema.vaultGrants.id, grantId));

  await recordVaultAudit({
    action: "grant.revoked",
    secretId: grant.secretId,
    appId: grant.appId,
    summary: `Revoked ${secret?.credentialKey || grant.secretId} from ${grant.appId}`,
    metadata: { grantId },
  });

  await recordAudit({
    action: "vault.grant.revoked",
    targetType: "vault-grant",
    targetId: grantId,
    summary: `Revoked vault secret "${secret?.name || grant.secretId}" from ${grant.appId}`,
  });

  return getGrant(grantId);
}

// ─── Sync ──────────────────────────────────────────────────────

export async function syncGrantsToApp(appId: string) {
  const db = getDb();
  const agents = await discoverAgents("dispatcher");
  const agent = agents.find((a) => a.id === appId);
  if (!agent) throw new Error(`App "${appId}" not found in agent registry`);

  const grants = await listGrants({ appId });
  const activeGrants = grants.filter((g) => g.status === "active");
  if (activeGrants.length === 0) {
    return { appId, synced: 0, keys: [] };
  }

  // Resolve secret values for each grant
  const vars: Array<{ key: string; value: string }> = [];
  for (const grant of activeGrants) {
    const secret = await getSecret(grant.secretId);
    if (secret) {
      vars.push({ key: secret.credentialKey, value: secret.value });
    }
  }

  if (vars.length === 0) {
    return { appId, synced: 0, keys: [] };
  }

  // Push to the app's env-vars endpoint
  const res = await fetch(`${agent.url}/_agent-native/env-vars`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vars }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Failed to sync to ${appId}: ${err}`);
  }

  const result = await res.json();
  const syncedKeys: string[] = result.saved || [];
  const timestamp = now();

  // Update syncedAt on grants that were successfully pushed
  for (const grant of activeGrants) {
    const secret = await getSecret(grant.secretId);
    if (secret && syncedKeys.includes(secret.credentialKey)) {
      await db
        .update(schema.vaultGrants)
        .set({ syncedAt: timestamp, updatedAt: timestamp })
        .where(eq(schema.vaultGrants.id, grant.id));
    }
  }

  await recordVaultAudit({
    action: "secret.synced",
    appId,
    summary: `Synced ${syncedKeys.length} secret(s) to ${appId}: ${syncedKeys.join(", ")}`,
    metadata: { syncedKeys },
  });

  return { appId, synced: syncedKeys.length, keys: syncedKeys };
}

// ─── Requests ──────────────────────────────────────────────────────

export async function listRequests(filter?: { status?: string }) {
  const db = getDb();
  const conditions = [orgFilter(schema.vaultRequests)];
  if (filter?.status) {
    conditions.push(eq(schema.vaultRequests.status, filter.status) as any);
  }
  return db
    .select()
    .from(schema.vaultRequests)
    .where(and(...conditions))
    .orderBy(desc(schema.vaultRequests.updatedAt));
}

export async function getRequest(requestId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vaultRequests)
    .where(eq(schema.vaultRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

export async function createRequest(input: {
  credentialKey: string;
  appId: string;
  reason?: string | null;
}) {
  const db = getDb();
  const timestamp = now();
  const requestId = id();
  const actor = currentOwnerEmail();

  await db.insert(schema.vaultRequests).values({
    id: requestId,
    ownerEmail: actor,
    orgId: currentOrgId(),
    credentialKey: input.credentialKey,
    appId: input.appId,
    reason: input.reason || null,
    requestedBy: actor,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await recordVaultAudit({
    action: "request.created",
    appId: input.appId,
    summary: `${actor} requested ${input.credentialKey} for ${input.appId}`,
    metadata: { requestId, reason: input.reason },
  });

  await notifyAdminsOfRequest(requestId, input);

  return getRequest(requestId);
}

export async function approveRequest(
  requestId: string,
  secretValue: string,
  secretName?: string,
) {
  const db = getDb();
  const request = await getRequest(requestId);
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") {
    throw new Error("Only pending requests can be approved");
  }

  const timestamp = now();
  const reviewer = currentOwnerEmail();

  // Update request status
  await db
    .update(schema.vaultRequests)
    .set({
      status: "approved",
      reviewedBy: reviewer,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.vaultRequests.id, requestId));

  // Check if secret already exists for this credential key
  const secrets = await listSecrets();
  let secret = secrets.find((s) => s.credentialKey === request.credentialKey);

  if (!secret) {
    // Create the secret
    secret = await createSecret({
      credentialKey: request.credentialKey,
      value: secretValue,
      name: secretName || request.credentialKey,
    });
  }

  if (secret) {
    // Create the grant
    await createGrant(secret.id, request.appId);
  }

  await recordVaultAudit({
    action: "request.approved",
    appId: request.appId,
    summary: `Approved ${request.credentialKey} for ${request.appId} (requested by ${request.requestedBy})`,
    metadata: { requestId, reviewer },
  });

  return getRequest(requestId);
}

export async function denyRequest(requestId: string, reason?: string | null) {
  const db = getDb();
  const request = await getRequest(requestId);
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") {
    throw new Error("Only pending requests can be denied");
  }

  const timestamp = now();
  const reviewer = currentOwnerEmail();

  await db
    .update(schema.vaultRequests)
    .set({
      status: "denied",
      reviewedBy: reviewer,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.vaultRequests.id, requestId));

  await recordVaultAudit({
    action: "request.denied",
    appId: request.appId,
    summary: `Denied ${request.credentialKey} for ${request.appId} (requested by ${request.requestedBy})`,
    metadata: { requestId, reviewer, reason },
  });

  return getRequest(requestId);
}

// ─── Integrations Catalog ────────────────────────────────────────

export interface IntegrationEntry {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  vaultGranted: boolean;
  vaultSecretId?: string;
}

export interface AppIntegrations {
  appId: string;
  appName: string;
  url: string;
  color: string;
  integrations: IntegrationEntry[];
  reachable: boolean;
}

export async function listIntegrationsCatalog(): Promise<AppIntegrations[]> {
  const agents = await discoverAgents("dispatcher");
  const grants = await listGrants();
  const secrets = await listSecrets();

  const secretByKey = new Map(secrets.map((s) => [s.credentialKey, s]));

  const results: AppIntegrations[] = [];

  for (const agent of agents) {
    try {
      const res = await fetch(`${agent.url}/_agent-native/env-status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        results.push({
          appId: agent.id,
          appName: agent.name,
          url: agent.url,
          color: agent.color,
          integrations: [],
          reachable: false,
        });
        continue;
      }

      const envStatus: Array<{
        key: string;
        label: string;
        required: boolean;
        configured: boolean;
      }> = await res.json();

      const appGrants = grants.filter(
        (g) => g.appId === agent.id && g.status === "active",
      );
      const grantedSecretIds = new Set(appGrants.map((g) => g.secretId));

      const integrations: IntegrationEntry[] = envStatus.map((env) => {
        const matchingSecret = secretByKey.get(env.key);
        return {
          key: env.key,
          label: env.label,
          required: env.required,
          configured: env.configured,
          vaultGranted:
            !!matchingSecret && grantedSecretIds.has(matchingSecret.id),
          vaultSecretId: matchingSecret?.id,
        };
      });

      results.push({
        appId: agent.id,
        appName: agent.name,
        url: agent.url,
        color: agent.color,
        integrations,
        reachable: true,
      });
    } catch {
      results.push({
        appId: agent.id,
        appName: agent.name,
        url: agent.url,
        color: agent.color,
        integrations: [],
        reachable: false,
      });
    }
  }

  return results;
}

// ─── Vault Overview (for dashboard) ──────────────────────────────

export async function listVaultOverview() {
  const [secrets, grants, requests] = await Promise.all([
    listSecrets(),
    listGrants(),
    listRequests(),
  ]);

  return {
    secretCount: secrets.length,
    activeGrantCount: grants.filter((g) => g.status === "active").length,
    pendingRequestCount: requests.filter((r) => r.status === "pending").length,
  };
}

// ─── SendGrid Notifications ──────────────────────────────────────

async function notifyAdminsOfRequest(
  requestId: string,
  input: { credentialKey: string; appId: string; reason?: string | null },
) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !from || !appUrl) return;

  // Use approval policy approver emails as admin notification targets
  const { getApprovalPolicy } = await import("./dispatcher-store.js");
  const policy = await getApprovalPolicy();
  if (policy.approverEmails.length === 0) return;

  const body = [
    `Secret request: ${input.credentialKey} for ${input.appId}`,
    input.reason ? `Reason: ${input.reason}` : "",
    `Requested by: ${currentOwnerEmail()}`,
    "",
    `Review it here: ${appUrl}/vault`,
  ]
    .filter(Boolean)
    .join("\n");

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: policy.approverEmails.map((email) => ({ email })),
          subject: `Vault request: ${input.credentialKey} for ${input.appId}`,
        },
      ],
      from: { email: from },
      content: [{ type: "text/plain", value: body }],
      custom_args: { requestId },
    }),
  }).catch(() => {});
}
