/**
 * Release-time creation of every framework-owned table that a store would
 * otherwise create on first use.
 *
 * `ensureTable()` is the framework's schema definition: the DDL lives next to
 * the store that owns it, and there is no second copy in a migration list. On a
 * long-lived server that works, because the first request creates what is
 * missing. On production serverless it does NOT: `schemaEnsureDisabled()` turns
 * every probe into "already present" so a cold start never pays for ~390
 * probes, which means nothing on the request path can create a table.
 *
 * So the release step has to run the same paths, and this module is the list
 * that makes it complete. It is deliberately explicit rather than a
 * side-effect-import registry: `package.json#sideEffects` is a narrow
 * allow-list, so an import kept only for its registration is exactly what a
 * bundler is entitled to drop — and the symptom would be a missing table in
 * production, months later.
 *
 * `guard:release-schema-complete` fails the build when a module calls
 * `ensureTableExists` and is not listed here.
 */

import { ensureTable as ensureA2aTaskStore } from "../a2a/task-store.js";
import { ensureAgentHarnessSessionTables as ensureAgentHarnessSessions } from "../agent/harness/store.js";
import { ensureTable as ensureObservationalMemory } from "../agent/observational-memory/store.js";
import { ensureRunTables as ensureAgentRuns } from "../agent/run-store.js";
import { ensureAgentToolApprovalTable as ensureAgentToolApprovals } from "../agent/tool-approval-store.js";
import { ensureTable as ensureApplicationState } from "../application-state/store.js";
import { ensureAuditTables as ensureAudit } from "../audit/store.js";
import { ensureTables as ensureBrowserSessions } from "../browser-sessions/store.js";
import { ensureChatThreadTables as ensureChatThreads } from "../chat-threads/store.js";
import { ensureCheckpointTable as ensureCheckpoints } from "../checkpoints/store.js";
import { ensureTable as ensureSandboxExecutions } from "../coding-tools/sandbox/executions-store.js";
import { ensureTable as ensureCollabAwareness } from "../collab/awareness-store.js";
import { ensureTable as ensureCollabDocs } from "../collab/storage.js";
import { ensureDataProgramTables as ensureDataPrograms } from "../data-programs/store.js";
import { ensureTable as ensureEmailLog } from "../email-catalog/log.js";
import { ensureExtensionsTables as ensureExtensions } from "../extensions/store.js";
import { ensureResourceVersionsTable as ensureResourceVersions } from "../history/store.js";
import { ensureTable as ensureA2aContinuations } from "../integrations/a2a-continuations-store.js";
import { ensureTable as ensureAwaitingInputs } from "../integrations/awaiting-input-store.js";
import { ensureComputerApprovalStore as ensureComputerApprovals } from "../integrations/computer-supervision-store.js";
import { ensureTable as ensureIntegrationConfigs } from "../integrations/config-store.js";
import { ensureTable as ensureIntegrationControls } from "../integrations/controls-store.js";
import { ensureTable as ensureIdentityLinks } from "../integrations/identity-links-store.js";
import { ensureTable as ensureInstallations } from "../integrations/installations-store.js";
import { ensureIntegrationCampaignsTable as ensureIntegrationCampaigns } from "../integrations/integration-campaigns-store.js";
import { ensurePendingTasksTable as ensurePendingTasks } from "../integrations/pending-tasks-store.js";
import { ensureTable as ensureRemoteCommands } from "../integrations/remote-commands-store.js";
import { ensureTable as ensureRemoteDevices } from "../integrations/remote-devices-store.js";
import { ensureTables as ensureRemotePush } from "../integrations/remote-push-store.js";
import { ensureTable as ensureRemoteRunEvents } from "../integrations/remote-run-events-store.js";
import { ensureTable as ensureConversationScopes } from "../integrations/scope-store.js";
import { ensureTable as ensureThreadMappings } from "../integrations/thread-mapping-store.js";
import { ensureTables as ensureUsageBudgets } from "../integrations/usage-budget-store.js";
import { ensureTable as ensureAutomationRunHistory } from "../jobs/run-history.js";
import { ensureHealthTable as ensureSchedulerHealth } from "../jobs/scheduler-health.js";
import { ensureApprovalTable as ensureMcpApprovals } from "../mcp/approval-store.js";
import { ensureTable as ensureMcpConnect } from "../mcp/connect-store.js";
import { ensureTable as ensureMcpOauth } from "../mcp/oauth-store.js";
import { ensureTable as ensureNotifications } from "../notifications/store.js";
import { ensureTable as ensureOauthTokens } from "../oauth-tokens/store.js";
import { ensureObservabilityTables as ensureObservability } from "../observability/store.js";
import { ensureTable as ensureProgress } from "../progress/store.js";
import { ensureTables as ensureProviderCorpusJobs } from "../provider-api/corpus-jobs-store.js";
import { ensureTable as ensureCustomApiProviders } from "../provider-api/custom-registry.js";
import { ensureCooldownTable as ensureProviderQuotaCooldowns } from "../provider-api/quota-governor.js";
import { ensureTables as ensureStagedDatasets } from "../provider-api/staged-datasets-store.js";
import { ensureTable as ensureResources } from "../resources/store.js";
import { ensureReviewTables as ensureReview } from "../review/store.js";
import { ensureTable as ensureAppSecrets } from "../secrets/storage.js";
import { ensureTable as ensureSettings } from "../settings/store.js";
import { ensureTables as ensureUsageAlerts } from "../usage/alerts-store.js";
import { ensureUsageTable as ensureUsage } from "../usage/store.js";
import { ensureWorkspaceUserGroupsTable as ensureWorkspaceUserGroups } from "../workspace-connections/groups.js";
import { ensureWorkspaceConnectionsTable as ensureWorkspaceConnections } from "../workspace-connections/store.js";
import { ensureTable as ensureAgentTeamRunQueue } from "./agent-teams-run-queue.js";
import { ensureSessionTable as ensureAuthSessions } from "./auth.js";
import { ensureTable as ensureEmbedSessions } from "./embed-session.js";
import { ensureTable as ensureIdentitySso } from "./identity-sso-store.js";
import { getDefaultAppSyncState } from "./poll.js";
import { ensureRecapImageTable as ensureRecapImages } from "./recap-image-store.js";

type SchemaEnsure = readonly [name: string, run: () => Promise<void>];

const FRAMEWORK_SCHEMA_ENSURES: readonly SchemaEnsure[] = [
  ["A2aContinuations", ensureA2aContinuations],
  ["A2aTaskStore", ensureA2aTaskStore],
  ["AgentHarnessSessions", ensureAgentHarnessSessions],
  ["AgentRuns", ensureAgentRuns],
  ["AgentTeamRunQueue", ensureAgentTeamRunQueue],
  ["AgentToolApprovals", ensureAgentToolApprovals],
  ["AppSecrets", ensureAppSecrets],
  ["ApplicationState", ensureApplicationState],
  ["Audit", ensureAudit],
  ["AuthSessions", ensureAuthSessions],
  ["AutomationRunHistory", ensureAutomationRunHistory],
  ["AwaitingInputs", ensureAwaitingInputs],
  ["BrowserSessions", ensureBrowserSessions],
  ["ChatThreads", ensureChatThreads],
  ["Checkpoints", ensureCheckpoints],
  ["CollabAwareness", ensureCollabAwareness],
  ["CollabDocs", ensureCollabDocs],
  ["ComputerApprovals", ensureComputerApprovals],
  ["ConversationScopes", ensureConversationScopes],
  ["CustomApiProviders", ensureCustomApiProviders],
  ["DataPrograms", ensureDataPrograms],
  ["EmailLog", ensureEmailLog],
  ["EmbedSessions", ensureEmbedSessions],
  ["Extensions", ensureExtensions],
  ["IdentityLinks", ensureIdentityLinks],
  ["IdentitySso", ensureIdentitySso],
  ["Installations", ensureInstallations],
  ["IntegrationCampaigns", ensureIntegrationCampaigns],
  ["IntegrationConfigs", ensureIntegrationConfigs],
  ["IntegrationControls", ensureIntegrationControls],
  ["McpApprovals", ensureMcpApprovals],
  ["McpConnect", ensureMcpConnect],
  ["McpOauth", ensureMcpOauth],
  ["Notifications", ensureNotifications],
  ["OauthTokens", ensureOauthTokens],
  ["Observability", ensureObservability],
  ["ObservationalMemory", ensureObservationalMemory],
  ["PendingTasks", ensurePendingTasks],
  ["Progress", ensureProgress],
  ["ProviderCorpusJobs", ensureProviderCorpusJobs],
  ["ProviderQuotaCooldowns", ensureProviderQuotaCooldowns],
  ["RecapImages", ensureRecapImages],
  ["RemoteCommands", ensureRemoteCommands],
  ["RemoteDevices", ensureRemoteDevices],
  ["RemotePush", ensureRemotePush],
  ["RemoteRunEvents", ensureRemoteRunEvents],
  ["ResourceVersions", ensureResourceVersions],
  ["Resources", ensureResources],
  ["Review", ensureReview],
  ["SandboxExecutions", ensureSandboxExecutions],
  ["SchedulerHealth", ensureSchedulerHealth],
  ["Settings", ensureSettings],
  ["StagedDatasets", ensureStagedDatasets],
  [
    "SyncEvents",
    () =>
      getDefaultAppSyncState()
        .ensureSyncEventsTable()
        .then(() => {}),
  ],
  ["ThreadMappings", ensureThreadMappings],
  ["Usage", ensureUsage],
  ["UsageAlerts", ensureUsageAlerts],
  ["UsageBudgets", ensureUsageBudgets],
  ["WorkspaceConnections", ensureWorkspaceConnections],
  ["WorkspaceUserGroups", ensureWorkspaceUserGroups],
];

/** Store names in release order. Exported for the guard and its tests. */
export function frameworkSchemaEnsureNames(): string[] {
  return FRAMEWORK_SCHEMA_ENSURES.map(([name]) => name);
}

/**
 * Create every framework-owned table, in one pass, before the app serves
 * traffic. Callers must already hold migration duty via `withMigrationRuntime`;
 * without it `schemaEnsureDisabled()` reports every table present and this
 * whole pass silently creates nothing.
 *
 * Sequential on purpose: these run against one database at release time, where
 * total wall clock does not matter and concurrent `CREATE TABLE` on a shared
 * Neon instance contends for `ACCESS EXCLUSIVE` locks.
 *
 * A failure aborts the release rather than being collected and reported at the
 * end. A half-created schema that reports success is the failure mode this
 * module exists to remove.
 */
export async function runFrameworkSchemaEnsures(
  // Injectable so the ordering and failure contract can be tested without
  // standing up 60 real stores; production callers pass nothing.
  ensures: readonly SchemaEnsure[] = FRAMEWORK_SCHEMA_ENSURES,
): Promise<void> {
  for (const [name, run] of ensures) {
    try {
      await run();
    } catch (err) {
      throw new Error(
        `Release schema step failed while creating ${name}: ${
          (err as Error)?.message ?? String(err)
        }`,
        { cause: err },
      );
    }
  }
}
