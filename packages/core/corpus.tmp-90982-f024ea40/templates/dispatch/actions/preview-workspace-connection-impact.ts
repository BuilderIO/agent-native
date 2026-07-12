import { defineAction } from "@agent-native/core";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import {
  getWorkspaceConnectionAppAccess,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderReadiness,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

const KNOWN_IMPACT_APPS = [
  { id: "brain", label: "Brain" },
  { id: "assets", label: "Assets" },
  { id: "analytics", label: "Analytics" },
  { id: "mail", label: "Mail" },
  { id: "dispatch", label: "Dispatch" },
] as const;

const operationSchema = z.enum([
  "revoke-connection",
  "disable-connection",
  "delete-connection",
  "revoke-app-grant",
]);

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function humanizeAppId(appId: string): string {
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function appLabel(appId: string): string {
  return (
    KNOWN_IMPACT_APPS.find((app) => app.id === appId)?.label ||
    humanizeAppId(appId) ||
    appId
  );
}

function optionalTimestamp(source: object, key: string) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const knownValues = values.filter((value) => value !== undefined);
  if (knownValues.length === 0) return undefined;
  const latest = knownValues.reduce<number | null>((current, value) => {
    const parsed = value ? Date.parse(value) : NaN;
    if (!Number.isFinite(parsed)) return current;
    return current == null || parsed > current ? parsed : current;
  }, null);
  return latest == null ? null : new Date(latest).toISOString();
}

function operationVerb(operation: z.infer<typeof operationSchema>) {
  switch (operation) {
    case "delete-connection":
      return "delete";
    case "disable-connection":
      return "disable";
    case "revoke-app-grant":
      return "revoke access to";
    case "revoke-connection":
      return "revoke";
  }
}

export default defineAction({
  description:
    "Preview which apps and grants would be affected before revoking, disabling, or deleting a shared workspace integration connection.",
  schema: z.object({
    connectionId: z
      .string()
      .describe("Workspace connection ID to preview impact for."),
    operation: operationSchema
      .default("delete-connection")
      .describe(
        "Change being considered: revoke-connection, disable-connection, delete-connection, or revoke-app-grant.",
      ),
    appId: z
      .string()
      .optional()
      .describe("Target app ID when operation is revoke-app-grant."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const connectionId = args.connectionId.trim();
    const targetAppId = args.appId?.trim();

    if (!connectionId) {
      throw new Error(
        "preview-workspace-connection-impact requires connectionId.",
      );
    }
    if (args.operation === "revoke-app-grant" && !targetAppId) {
      throw new Error(
        "preview-workspace-connection-impact requires appId for revoke-app-grant.",
      );
    }

    const connections = await listWorkspaceConnections({
      includeDisabled: true,
    });
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) {
      throw new Error(`Workspace connection "${connectionId}" not found.`);
    }

    const [allProviderGrants, connectionGrants] = await Promise.all([
      listWorkspaceConnectionGrants({ provider: connection.provider }),
      listWorkspaceConnectionGrants({ connectionId: connection.id }),
    ]);
    const provider = getWorkspaceConnectionProvider(connection.provider);
    const recommendedAppIds = unique(
      provider?.recommendedTemplateUses.map((appId) => appId) ?? [],
    );
    const selectedAppIds = unique(connection.allowedApps);
    const explicitGrantAppIds = unique(
      connectionGrants.map((grant) => grant.appId),
    );
    const allApps = selectedAppIds.length === 0;
    const trackedAppIds = unique([
      ...KNOWN_IMPACT_APPS.map((app) => app.id),
      ...recommendedAppIds,
      ...selectedAppIds,
      ...explicitGrantAppIds,
      ...(targetAppId ? [targetAppId] : []),
    ]);

    const trackedApps = trackedAppIds.map((appId) => {
      const access = getWorkspaceConnectionAppAccess(
        connection,
        appId,
        connectionGrants,
      );
      const grant = connectionGrants.find((item) => item.appId === appId);
      const grantLastUsedAt = grant
        ? optionalTimestamp(grant, "lastUsedAt")
        : undefined;
      const connectionLastUsedAt = optionalTimestamp(connection, "lastUsedAt");
      return {
        appId,
        label: appLabel(appId),
        granted: access.available,
        mode: access.mode,
        grantId: access.grantId,
        reason: access.reason,
        recommendedForProvider: recommendedAppIds.includes(appId),
        ...(grantLastUsedAt !== undefined
          ? { lastUsedAt: grantLastUsedAt }
          : connectionLastUsedAt !== undefined
            ? { lastUsedAt: connectionLastUsedAt }
            : {}),
      };
    });

    const usedByApps =
      args.operation === "revoke-app-grant"
        ? trackedApps.filter((app) => app.appId === targetAppId && app.granted)
        : trackedApps.filter((app) => app.granted);
    const likelyAffectedApps = usedByApps.map((app) => ({
      appId: app.appId,
      label: app.label,
      accessMode: app.mode,
      grantId: app.grantId,
      likelyImpact:
        args.operation === "revoke-app-grant"
          ? `${app.label} would no longer be able to use this shared connection.`
          : `${app.label} may lose access to this provider account until another connection or app-local setup is available.`,
      recommendedForProvider: app.recommendedForProvider,
      ...(Object.prototype.hasOwnProperty.call(app, "lastUsedAt")
        ? { lastUsedAt: app.lastUsedAt }
        : {}),
    }));

    const lastUsedAt = latestTimestamp([
      optionalTimestamp(connection, "lastUsedAt"),
      ...connectionGrants.map((grant) =>
        optionalTimestamp(grant, "lastUsedAt"),
      ),
    ]);
    const affectedLabels = likelyAffectedApps.map((app) => app.label);
    const affectedSummary =
      affectedLabels.length > 0
        ? affectedLabels.slice(0, 4).join(", ") +
          (affectedLabels.length > 4
            ? `, and ${affectedLabels.length - 4} more`
            : "")
        : "no currently granted apps";
    const connectionLabel =
      connection.label ||
      connection.accountLabel ||
      provider?.label ||
      connection.provider;
    const targetLabel = targetAppId ? appLabel(targetAppId) : null;
    const actionPhrase =
      args.operation === "revoke-app-grant" && targetLabel
        ? `revoke ${targetLabel}'s access to ${connectionLabel}`
        : `${operationVerb(args.operation)} ${connectionLabel}`;
    const recommendedBody =
      args.operation === "delete-connection"
        ? `Deleting ${connectionLabel} removes the shared connection metadata and its app grants. Likely affected: ${affectedSummary}. Secret values remain in Vault/OAuth stores, but apps may stop working until another connection is granted.`
        : args.operation === "disable-connection"
          ? `Disabling ${connectionLabel} keeps the connection record and grants, but apps cannot use it while disabled. Likely affected: ${affectedSummary}.`
          : args.operation === "revoke-app-grant" && targetLabel
            ? `Revoking ${targetLabel}'s grant leaves ${connectionLabel} connected for other apps, but ${targetLabel} may stop using this provider account.`
            : `Revoking ${connectionLabel} access may prevent currently granted apps from using this provider account. Likely affected: ${affectedSummary}.`;

    return {
      operation: args.operation,
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        accountId: connection.accountId,
        accountLabel: connection.accountLabel,
        status: connection.status,
        scopes: connection.scopes,
        credentialRefs: connection.credentialRefs.map((ref) => ({
          key: ref.key,
          label: ref.label,
          provider: ref.provider,
          scope: ref.scope,
        })),
        configKeys: Object.keys(connection.config ?? {}),
        lastCheckedAt: connection.lastCheckedAt,
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
        lastError: connection.lastError,
      },
      provider: provider
        ? {
            id: provider.id,
            label: provider.label,
            description: provider.description,
            capabilities: provider.capabilities,
            recommendedTemplateUses: provider.recommendedTemplateUses,
            requiredCredentialKeys: provider.credentialKeys
              .filter((key) => key.required)
              .map((key) => key.key),
            readiness: summarizeWorkspaceConnectionProviderReadiness({
              provider,
              connections,
              grants: allProviderGrants,
              includeConnections: "all",
            }),
          }
        : null,
      currentAppGrants: {
        accessMode: allApps
          ? ("all-apps" as const)
          : ("selected-apps" as const),
        allApps,
        selectedAppIds,
        explicitGrantAppIds,
        effectiveAppIds: allApps
          ? ["*"]
          : unique([...selectedAppIds, ...explicitGrantAppIds]),
        trackedApps,
      },
      usedByApps,
      likelyAffectedApps,
      impactSummary: {
        likelyAffectedCount: likelyAffectedApps.length,
        likelyAffectedLabels: affectedLabels,
        hasAllAppsAccess: allApps,
        usageTracked: lastUsedAt !== undefined,
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
      },
      recommendedConfirmation: {
        title:
          args.operation === "revoke-app-grant" && targetLabel
            ? `Revoke ${targetLabel} access?`
            : `${operationVerb(args.operation)
                .charAt(0)
                .toUpperCase()}${operationVerb(args.operation).slice(1)} connection?`,
        body: recommendedBody,
        confirmLabel:
          args.operation === "revoke-app-grant"
            ? "Revoke access"
            : args.operation === "disable-connection"
              ? "Disable connection"
              : args.operation === "delete-connection"
                ? "Delete connection"
                : "Revoke connection",
        confirmationCopy: `Confirm you want to ${actionPhrase}.`,
      },
    };
  },
});
