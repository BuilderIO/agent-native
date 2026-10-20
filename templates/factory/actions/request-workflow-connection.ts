import {
  AgentConnectionRequiredError,
  defineAction,
  fail,
} from "@agent-native/core/action";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import {
  PROVIDER_VAULT_KEYS,
  readProviderConnections,
} from "../server/lib/factory-workflow-connections.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";
import { FACTORY_APP_ID } from "../server/lib/provider-api.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";

// The pollers name their provider directly, with no operation behind it.
const POLLER_PROVIDERS = ["slack", "github", "sentry"];

function knownProviders(): string[] {
  return [
    ...new Set([
      ...POLLER_PROVIDERS,
      ...OPERATION_CATALOG.list().map((entry) => entry.credential.provider),
    ]),
  ].sort();
}

// Where a person connects what the chat connect card cannot: Factory's own
// Settings pages, named the way the sidebar names them.
function manualSetup(provider: string): { where: string; keys: string[] } {
  if (provider === "builder") {
    return { where: "Settings, Integrations, Builder", keys: [] };
  }
  if (provider === "email") {
    return {
      where: "Settings, API keys",
      keys: ["RESEND_API_KEY, or SENDGRID_API_KEY with EMAIL_FROM"],
    };
  }
  return {
    where: "Settings, API keys",
    keys: (PROVIDER_VAULT_KEYS[provider] ?? []).map((set) => set.join(" and ")),
  };
}

export default defineAction({
  description:
    "Ask the user to connect an integration a workflow needs. Call it for each provider that save-factory-workflow or get-factory-workflow lists as not connected, or that a dry-run step failed with credential_missing for. For Slack, GitHub, Sentry, HubSpot, Jira, Notion and BigQuery it shows the connect card in the chat and the turn waits for the user to finish; ask for one provider per turn. For a provider connected by key or in Settings (Gong, Pylon, Stripe, PostHog, Builder, email) it returns connected: false with where to add it and the key names, which you then tell the user. When the provider is already connected it says so.",
  schema: z.object({
    provider: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .describe(
        "The provider as the connections list names it, such as slack or github.",
      ),
  }),
  http: false,
  readOnly: true,
  // After the user connects, the same call must check again rather than
  // replay the answer from before.
  dedupe: false,
  run: async (input, context) =>
    watchAgentCall(
      { action: "request-workflow-connection", input, context, slow: true },
      async (watch) => {
        const { provider } = input;
        const { userEmail, orgId } = await requireWorkspaceMember(
          workspaceMemberIdentityFromContext(context),
        );
        watch.inOrg(orgId);
        if (!knownProviders().includes(provider) && provider !== "factory") {
          fail(
            `No workflow operation uses "${provider}". Providers: ${knownProviders().join(", ")}.`,
            { errorCode: "unknown_provider", statusCode: 404 },
          );
        }
        const [connection] = await readProviderConnections([provider], {
          userEmail,
          orgId,
        });
        if (connection.status === "connected") {
          return {
            provider,
            connected: true,
            message: `${provider} is already connected; nothing to do.`,
          };
        }
        if (connection.status === "unknown") {
          fail(
            `Whether ${provider} is connected could not be checked${connection.detail ? `: ${connection.detail}` : "."} Ask the user to check it in Settings, Integrations.`,
            {
              errorCode: "connection_check_failed",
              statusCode: 502,
              details: { provider, connectWith: connection.connectWith },
            },
          );
        }

        const catalogProvider = getWorkspaceConnectionProvider(provider);
        if (
          connection.connectWith !== "workspace-connection" ||
          !catalogProvider
        ) {
          const { where, keys } = manualSetup(provider);
          return {
            provider,
            connected: false,
            connectWith: connection.connectWith,
            where,
            keys,
            message: `${provider} is not connected and has no connect card. Tell the user to add it under ${where}${keys.length > 0 ? ` (${keys.join("; ")})` : ""}, then check again.`,
          };
        }

        const resolved = await resolveWorkspaceConnectionForApp({
          appId: FACTORY_APP_ID,
          provider,
          includeDisabled: true,
          requireConnected: false,
        });
        const reason =
          resolved.connection && resolved.appAccess?.available === false
            ? "grant"
            : resolved.connection && resolved.connection.status !== "connected"
              ? "reauthorize"
              : "connect";
        const label = catalogProvider.label;
        throw new AgentConnectionRequiredError(
          reason === "grant"
            ? `${label} is connected, but Factory has not been granted access to it.`
            : reason === "reauthorize"
              ? `${label}'s connection needs to be authorized again.`
              : `${label} is not connected, so this workflow's ${label} steps cannot run.`,
          {
            provider,
            reason,
            appId: FACTORY_APP_ID,
            source: {
              id: provider,
              kind: "workspace_connection",
              label,
            },
          },
        );
      },
    ),
});
