import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { getDbExec, withDbExec } from "@agent-native/core/db";
import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import {
  deleteAppSecret,
  listAppSecretsForScope,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  listWorkspaceConnectionsForApp,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials.js";
import {
  SIGMA_DIRECT_CREDENTIALS_KEY,
  SIGMA_DIRECT_CONNECTION_LABEL,
  SIGMA_DIRECT_CONNECTION_MARKER,
  SIGMA_PROVIDER_ID,
  normalizeSigmaBaseUrl,
} from "../server/lib/sigma-connection.js";

function setupCredentialKeys(setupId: string) {
  const prefix = `ANALYTICS_SIGMA_SETUP_${setupId}`;
  return [
    `${prefix}_CLIENT_ID`,
    `${prefix}_CLIENT_SECRET`,
    `${prefix}_BASE_URL`,
  ] as const;
}

async function clearExpiredSigmaSetupCredentials(orgId: string) {
  const cutoff = Date.now() - 60 * 60 * 1_000;
  const stagedSecrets = await listAppSecretsForScope("workspace", orgId);
  const expiredKeys = stagedSecrets
    .filter(
      ({ key, updatedAt }) =>
        updatedAt < cutoff &&
        /^ANALYTICS_SIGMA_SETUP_[0-9a-f-]{36}_(CLIENT_ID|CLIENT_SECRET|BASE_URL)$/i.test(
          key,
        ),
    )
    .map(({ key }) => key);
  await Promise.all(
    expiredKeys.map((key) =>
      deleteAppSecret({ key, scope: "workspace", scopeId: orgId }),
    ),
  );
}

async function clearSigmaSetupCredentials(orgId: string, setupId: string) {
  await Promise.all(
    setupCredentialKeys(setupId).map((key) =>
      deleteAppSecret({ key, scope: "workspace", scopeId: orgId }),
    ),
  );
}

function isWorkbookListResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.entries) &&
    Object.prototype.hasOwnProperty.call(response, "nextPage") &&
    (response.nextPage === null || typeof response.nextPage === "string")
  );
}

export default defineAction({
  description:
    "UI-only: verify temporary Sigma credentials and create an Analytics-only connection. Requires an organization owner or admin.",
  schema: z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("discard"), setupId: z.string().uuid() }),
    z.object({
      operation: z.literal("verify"),
      setupId: z.string().uuid(),
      useDefaultBaseUrl: z.boolean(),
    }),
  ]),
  outputSchema: z.object({
    connectionId: z.string(),
    status: z.string(),
    cleanupPending: z.boolean(),
  }),
  agentTool: false,
  audit: {
    recordInputs: false,
    summary: (_args, _result, meta) =>
      meta.status === "success"
        ? "Connected Sigma to Analytics"
        : "Failed to connect Sigma to Analytics",
  },
  run: async (input, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    if (input.operation === "discard") {
      await clearSigmaSetupCredentials(admin.orgId, input.setupId);
      return { connectionId: "", status: "discarded", cleanupPending: false };
    }

    const credentialKeys = setupCredentialKeys(input.setupId);
    const setupConnectionId = `analytics-sigma-credential-check-${input.setupId}`;
    const db = getDbExec();
    if (!db.transaction) {
      fail(
        "Analytics could not safely save the Sigma connection. Try again from the Analytics app.",
        {
          errorCode: "sigma_connection_transactions_unavailable",
          statusCode: 503,
        },
      );
    }

    await clearExpiredSigmaSetupCredentials(admin.orgId);
    const credentialContext = {
      userEmail: admin.userEmail,
      orgId: admin.orgId,
      credentialScope: "org" as const,
    };
    const [setupClientId, setupClientSecret, setupBaseUrlSecret] =
      await Promise.all(
        credentialKeys.map((key) =>
          readAppSecret({ key, scope: "workspace", scopeId: admin.orgId }),
        ),
      );
    if (!setupClientId?.value.trim() || !setupClientSecret?.value) {
      fail("Save the Sigma client ID and client secret first.", {
        errorCode: "sigma_credentials_required",
        statusCode: 409,
      });
    }

    const setupBaseUrl = input.useDefaultBaseUrl
      ? undefined
      : setupBaseUrlSecret?.value.trim() || undefined;
    const validatedBaseUrl = setupBaseUrl
      ? normalizeSigmaBaseUrl(setupBaseUrl)
      : undefined;
    if (setupBaseUrl && !validatedBaseUrl) {
      fail("Use an HTTPS Sigma API URL on a sigmacomputing.com domain.", {
        errorCode: "sigma_base_url_invalid",
        statusCode: 400,
      });
    }

    const runtime = createProviderApiRuntime({
      appId: ANALYTICS_APP_ID,
      providerIds: [SIGMA_PROVIDER_ID],
      getCredentialContext: () => credentialContext,
      resolveCredential: async ({ appId, provider, key, connectionId }) => {
        if (
          appId !== ANALYTICS_APP_ID ||
          provider !== SIGMA_PROVIDER_ID ||
          connectionId !== setupConnectionId
        ) {
          return null;
        }
        const normalizedKey = key.trim().toUpperCase();
        const value =
          normalizedKey === "SIGMA_CLIENT_ID"
            ? setupClientId.value.trim()
            : normalizedKey === "SIGMA_CLIENT_SECRET"
              ? setupClientSecret.value
              : normalizedKey === "SIGMA_BASE_URL"
                ? validatedBaseUrl
                : undefined;
        if (!value) return null;
        return {
          key: normalizedKey,
          value,
          source: "analytics_sigma_setup",
          provider: SIGMA_PROVIDER_ID,
          connectionId: setupConnectionId,
          scope: "org",
          scopeId: admin.orgId,
        };
      },
    });

    let verificationResponse: unknown;
    try {
      const result = (await runtime.executeRequest({
        provider: SIGMA_PROVIDER_ID,
        method: "GET",
        path: "/v2/workbooks",
        query: { limit: 1 },
        connectionId: setupConnectionId,
        timeoutMs: 30_000,
        maxBytes: 64_000,
      })) as { response?: unknown };
      verificationResponse = result.response;
    } catch {
      fail(
        "Sigma credentials could not be verified. Check the client ID, client secret, and API region.",
        {
          errorCode: "sigma_connection_verification_failed",
          statusCode: 502,
        },
      );
    }
    const response =
      verificationResponse && typeof verificationResponse === "object"
        ? (verificationResponse as Record<string, unknown>)
        : null;
    if (
      !response ||
      response.ok !== true ||
      response.truncated === true ||
      !isWorkbookListResponse(response.json)
    ) {
      fail(
        "Sigma credentials could not be verified. Check the client ID, client secret, and API region.",
        {
          errorCode: "sigma_connection_verification_failed",
          statusCode: 502,
        },
      );
    }

    const directCredentials = JSON.stringify({
      clientId: setupClientId.value.trim(),
      clientSecret: setupClientSecret.value,
      ...(validatedBaseUrl ? { baseUrl: validatedBaseUrl } : {}),
    });
    try {
      const connection = await db.transaction((tx) =>
        withDbExec(tx, async () => {
          await tx.execute({
            sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
            args: [`agent-native:analytics-sigma-connection:${admin.orgId}`],
          });
          const existingConnections = await listWorkspaceConnectionsForApp({
            appId: ANALYTICS_APP_ID,
            provider: SIGMA_PROVIDER_ID,
            includeDisabled: true,
          });
          const directConnection = existingConnections.find(
            (connection) =>
              connection.config.analyticsSetup ===
              SIGMA_DIRECT_CONNECTION_MARKER,
          );
          if (
            directConnection &&
            (directConnection.allowedApps.length !== 1 ||
              directConnection.allowedApps[0] !== ANALYTICS_APP_ID ||
              directConnection.allowedUsers.length > 0 ||
              (directConnection.allowedUserGroups?.length ?? 0) > 0)
          ) {
            fail(
              "The existing Analytics Sigma connection has an unexpected access policy.",
              {
                errorCode: "sigma_connection_policy_invalid",
                statusCode: 409,
              },
            );
          }

          await writeAppSecret({
            key: SIGMA_DIRECT_CREDENTIALS_KEY,
            value: directCredentials,
            scope: "org",
            scopeId: admin.orgId,
          });

          return upsertWorkspaceConnection({
            id:
              directConnection?.id ?? `analytics-sigma-direct-${input.setupId}`,
            provider: SIGMA_PROVIDER_ID,
            label: SIGMA_DIRECT_CONNECTION_LABEL,
            accountId: directConnection?.accountId ?? null,
            accountLabel: directConnection?.accountLabel ?? null,
            scopes: directConnection?.scopes ?? [],
            config: {
              analyticsSetup: SIGMA_DIRECT_CONNECTION_MARKER,
            },
            allowedApps: [ANALYTICS_APP_ID],
            allowedUsers: [],
            allowedUserGroups: [],
            credentialRefs: [
              {
                key: SIGMA_DIRECT_CREDENTIALS_KEY,
                scope: "org" as const,
                provider: SIGMA_PROVIDER_ID,
              },
            ],
            status: "connected",
            lastCheckedAt: Date.now(),
            lastError: null,
          });
        }),
      );
      let cleanupPending = false;
      try {
        await clearSigmaSetupCredentials(admin.orgId, input.setupId);
      } catch {
        cleanupPending = true;
      }
      return {
        connectionId: connection.id,
        status: connection.status,
        cleanupPending,
      };
    } catch (error) {
      if (isActionContractError(error)) throw error;
      fail(
        "Sigma credentials were verified, but Analytics could not save them. The previous connection is unchanged.",
        {
          errorCode: "sigma_connection_save_failed",
          statusCode: 500,
        },
      );
    }
  },
});
