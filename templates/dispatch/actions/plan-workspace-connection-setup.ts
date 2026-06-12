import { defineAction } from "@agent-native/core";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import {
  getWorkspaceConnection,
  listWorkspaceConnectionGrants,
  summarizeWorkspaceConnectionProviderReadiness,
} from "@agent-native/core/workspace-connections";
import { dispatchActions } from "@agent-native/dispatch/actions";
import { z } from "zod";

type WorkspaceApp = {
  id: string;
  name?: string;
  status?: "ready" | "pending";
  archived?: boolean;
};

function uniqueStrings(values: string[]): string[] {
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

async function listGrantApps() {
  const listWorkspaceApps = dispatchActions["list-workspace-apps"];
  if (!listWorkspaceApps) return [{ id: "dispatch", label: "Dispatch" }];

  try {
    const apps = (await listWorkspaceApps.run({
      includeAgentCards: false,
      audience: "all",
    } as any)) as WorkspaceApp[];
    const grantApps = apps
      .filter((app) => !app.archived && app.status !== "pending")
      .map((app) => ({
        id: app.id,
        label: app.name || humanizeAppId(app.id),
      }));
    return grantApps.length > 0
      ? grantApps
      : [{ id: "dispatch", label: "Dispatch" }];
  } catch {
    return [{ id: "dispatch", label: "Dispatch" }];
  }
}

export default defineAction({
  description:
    "Plan a safe workspace integration setup or repair flow without returning secret values.",
  schema: z.object({
    provider: z
      .string()
      .optional()
      .describe("Provider ID to plan, such as slack, github, or notion."),
    connectionId: z
      .string()
      .optional()
      .describe("Existing connection ID to repair or summarize."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const connection = args.connectionId
      ? await getWorkspaceConnection(args.connectionId)
      : null;
    if (args.connectionId && !connection) {
      throw new Error(`Workspace connection "${args.connectionId}" not found.`);
    }

    const providerId = args.provider?.trim() || connection?.provider;
    if (!providerId) {
      throw new Error(
        "plan-workspace-connection-setup requires provider or connectionId.",
      );
    }

    const provider = getWorkspaceConnectionProvider(providerId);
    if (!provider) {
      throw new Error(
        `Unknown workspace connection provider "${providerId}". Use list-workspace-connections to see valid provider IDs.`,
      );
    }

    const existingRefs = connection?.credentialRefs ?? [];
    const existingRefKeys = new Set(existingRefs.map((ref) => ref.key));
    const missingRequiredRefs = provider.credentialKeys
      .filter((credential) => credential.required)
      .map((credential) => credential.key)
      .filter((key) => !existingRefKeys.has(key));
    const recommendedAppIds = uniqueStrings([
      "dispatch",
      ...provider.recommendedTemplateUses,
    ]);
    const grantApps = await listGrantApps();
    const suggestedApps = grantApps.map((app) => ({
      ...app,
      recommended: recommendedAppIds.includes(app.id),
    }));
    const explicitGrants = connection
      ? await listWorkspaceConnectionGrants({ connectionId: connection.id })
      : [];
    const warnings: string[] = [];

    if (missingRequiredRefs.length > 0) {
      warnings.push(
        `Missing required credential refs: ${missingRequiredRefs.join(", ")}`,
      );
    }
    if (connection?.status === "error" && connection.lastError) {
      warnings.push(connection.lastError);
    } else if (
      connection?.status === "needs_reauth" ||
      connection?.status === "disabled"
    ) {
      warnings.push(`Connection status is ${connection.status}.`);
    }

    const accessMode =
      connection && connection.allowedApps.length === 0
        ? "all-apps"
        : "selected-apps";
    const selectedAppIds = connection
      ? uniqueStrings([
          ...connection.allowedApps,
          ...explicitGrants.map((grant) => grant.appId),
        ])
      : recommendedAppIds.filter((appId) =>
          suggestedApps.some((app) => app.id === appId),
        );

    return {
      provider: {
        id: provider.id,
        label: provider.label,
        description: provider.description,
        credentialKeys: provider.credentialKeys,
        capabilities: provider.capabilities,
        recommendedTemplateUses: provider.recommendedTemplateUses,
        readiness: summarizeWorkspaceConnectionProviderReadiness({
          provider,
          connections: connection ? [connection] : [],
          grants: explicitGrants,
          includeConnections: "all",
        }),
      },
      requiredCredentialRefs: provider.credentialKeys.filter(
        (credential) => credential.required,
      ),
      suggestedCredentialRefs: provider.credentialKeys.map((credential) => {
        const existing = existingRefs.find((ref) => ref.key === credential.key);
        return {
          key: existing?.key ?? credential.key,
          label: existing?.label ?? credential.label,
          provider: existing?.provider ?? provider.id,
          scope: existing?.scope ?? "org",
          required: Boolean(credential.required),
          description: credential.description,
        };
      }),
      suggestedApps,
      grantRecommendation: {
        accessMode,
        selectedAppIds:
          accessMode === "all-apps" ? [] : uniqueStrings(selectedAppIds),
        reason:
          accessMode === "all-apps"
            ? "This existing connection is available to every workspace app."
            : "Start with Dispatch and the apps this provider commonly supports.",
      },
      warnings,
      connection: connection
        ? {
            id: connection.id,
            provider: connection.provider,
            label: connection.label,
            accountId: connection.accountId,
            accountLabel: connection.accountLabel,
            status: connection.status,
            scopes: connection.scopes,
            allowedApps: connection.allowedApps,
            credentialRefs: existingRefs.map((ref) => ({
              key: ref.key,
              label: ref.label,
              provider: ref.provider,
              scope: ref.scope,
            })),
            lastError: connection.lastError,
          }
        : null,
      explicitGrantAppIds: explicitGrants.map((grant) => grant.appId),
    };
  },
});
