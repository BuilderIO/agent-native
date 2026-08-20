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
 * The imports are dynamic on purpose. `server/index.ts` and `server/edge.ts`
 * re-export `runFrameworkReleaseMigrations`, so a static list here would pull
 * all 60 store modules into the graph of every server boot to serve a path
 * that runs once, at release. Loading them inside the step keeps request cold
 * starts unchanged.
 *
 * `guard:release-schema-complete` fails the build when a module defines schema
 * and is not listed here.
 */

type SchemaEnsure = readonly [name: string, run: () => Promise<void>];

const FRAMEWORK_SCHEMA_ENSURES: readonly SchemaEnsure[] = [
  [
    "A2aContinuations",
    () =>
      import("../integrations/a2a-continuations-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "A2aTaskStore",
    () => import("../a2a/task-store.js").then((m) => m.ensureTable()),
  ],
  [
    "AgentHarnessSessions",
    () =>
      import("../agent/harness/store.js").then((m) =>
        m.ensureAgentHarnessSessionTables(),
      ),
  ],
  [
    "AgentRuns",
    () => import("../agent/run-store.js").then((m) => m.ensureRunTables()),
  ],
  [
    "AgentTeamRunQueue",
    () => import("./agent-teams-run-queue.js").then((m) => m.ensureTable()),
  ],
  [
    "AgentToolApprovals",
    () =>
      import("../agent/tool-approval-store.js").then((m) =>
        m.ensureAgentToolApprovalTable(),
      ),
  ],
  [
    "AppSecrets",
    () => import("../secrets/storage.js").then((m) => m.ensureTable()),
  ],
  [
    "ApplicationState",
    () => import("../application-state/store.js").then((m) => m.ensureTable()),
  ],
  [
    "Audit",
    () => import("../audit/store.js").then((m) => m.ensureAuditTables()),
  ],
  [
    "AuthSessions",
    () => import("./auth.js").then((m) => m.ensureSessionTable()),
  ],
  [
    "AutomationRunHistory",
    () => import("../jobs/run-history.js").then((m) => m.ensureTable()),
  ],
  [
    "AwaitingInputs",
    () =>
      import("../integrations/awaiting-input-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "BrowserSessions",
    () => import("../browser-sessions/store.js").then((m) => m.ensureTables()),
  ],
  [
    "ChatThreads",
    () =>
      import("../chat-threads/store.js").then((m) =>
        m.ensureChatThreadTables(),
      ),
  ],
  [
    "Checkpoints",
    () =>
      import("../checkpoints/store.js").then((m) => m.ensureCheckpointTable()),
  ],
  [
    "CollabAwareness",
    () => import("../collab/awareness-store.js").then((m) => m.ensureTable()),
  ],
  [
    "CollabDocs",
    () => import("../collab/storage.js").then((m) => m.ensureTable()),
  ],
  [
    "ComputerApprovals",
    () =>
      import("../integrations/computer-supervision-store.js").then((m) =>
        m.ensureComputerApprovalStore(),
      ),
  ],
  [
    "ConversationScopes",
    () => import("../integrations/scope-store.js").then((m) => m.ensureTable()),
  ],
  [
    "CustomApiProviders",
    () =>
      import("../provider-api/custom-registry.js").then((m) => m.ensureTable()),
  ],
  [
    "DataPrograms",
    () =>
      import("../data-programs/store.js").then((m) =>
        m.ensureDataProgramTables(),
      ),
  ],
  [
    "EmailLog",
    () => import("../email-catalog/log.js").then((m) => m.ensureTable()),
  ],
  [
    "EmbedSessions",
    () => import("./embed-session.js").then((m) => m.ensureTable()),
  ],
  [
    "ExtensionSlots",
    () =>
      import("../extensions/slots/store.js").then((m) => m.ensureSlotTables()),
  ],
  [
    "Extensions",
    () =>
      import("../extensions/store.js").then((m) => m.ensureExtensionsTables()),
  ],
  [
    "IdentityLinks",
    () =>
      import("../integrations/identity-links-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "IdentitySso",
    () => import("./identity-sso-store.js").then((m) => m.ensureTable()),
  ],
  [
    "Installations",
    () =>
      import("../integrations/installations-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "IntegrationCampaigns",
    () =>
      import("../integrations/integration-campaigns-store.js").then((m) =>
        m.ensureIntegrationCampaignsTable(),
      ),
  ],
  [
    "IntegrationConfigs",
    () =>
      import("../integrations/config-store.js").then((m) => m.ensureTable()),
  ],
  [
    "IntegrationControls",
    () =>
      import("../integrations/controls-store.js").then((m) => m.ensureTable()),
  ],
  [
    "McpApprovals",
    () =>
      import("../mcp/approval-store.js").then((m) => m.ensureApprovalTable()),
  ],
  [
    "McpConnect",
    () => import("../mcp/connect-store.js").then((m) => m.ensureTable()),
  ],
  [
    "McpOauth",
    () => import("../mcp/oauth-store.js").then((m) => m.ensureTable()),
  ],
  [
    "Notifications",
    () => import("../notifications/store.js").then((m) => m.ensureTable()),
  ],
  [
    "OauthTokens",
    () => import("../oauth-tokens/store.js").then((m) => m.ensureTable()),
  ],
  [
    "Observability",
    () =>
      import("../observability/store.js").then((m) =>
        m.ensureObservabilityTables(),
      ),
  ],
  [
    "ObservationalMemory",
    () =>
      import("../agent/observational-memory/store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "PendingTasks",
    () =>
      import("../integrations/pending-tasks-store.js").then((m) =>
        m.ensurePendingTasksTable(),
      ),
  ],
  [
    "Progress",
    () => import("../progress/store.js").then((m) => m.ensureTable()),
  ],
  [
    "ProviderCorpusJobs",
    () =>
      import("../provider-api/corpus-jobs-store.js").then((m) =>
        m.ensureTables(),
      ),
  ],
  [
    "ProviderQuotaCooldowns",
    () =>
      import("../provider-api/quota-governor.js").then((m) =>
        m.ensureCooldownTable(),
      ),
  ],
  [
    "RecapImages",
    () =>
      import("./recap-image-store.js").then((m) => m.ensureRecapImageTable()),
  ],
  [
    "RemoteCommands",
    () =>
      import("../integrations/remote-commands-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "RemoteDevices",
    () =>
      import("../integrations/remote-devices-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "RemotePush",
    () =>
      import("../integrations/remote-push-store.js").then((m) =>
        m.ensureTables(),
      ),
  ],
  [
    "RemoteRunEvents",
    () =>
      import("../integrations/remote-run-events-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "ResourceVersions",
    () =>
      import("../history/store.js").then((m) =>
        m.ensureResourceVersionsTable(),
      ),
  ],
  [
    "Resources",
    () => import("../resources/store.js").then((m) => m.ensureTable()),
  ],
  [
    "Review",
    () => import("../review/store.js").then((m) => m.ensureReviewTables()),
  ],
  [
    "SandboxExecutions",
    () =>
      import("../coding-tools/sandbox/executions-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "SchedulerHealth",
    () =>
      import("../jobs/scheduler-health.js").then((m) => m.ensureHealthTable()),
  ],
  [
    "Settings",
    () => import("../settings/store.js").then((m) => m.ensureTable()),
  ],
  [
    "StagedDatasets",
    () =>
      import("../provider-api/staged-datasets-store.js").then((m) =>
        m.ensureTables(),
      ),
  ],
  [
    "SyncEvents",
    () =>
      import("./poll.js").then((m) =>
        m
          .getDefaultAppSyncState()
          .ensureSyncEventsTable()
          .then(() => {}),
      ),
  ],
  [
    "ThreadMappings",
    () =>
      import("../integrations/thread-mapping-store.js").then((m) =>
        m.ensureTable(),
      ),
  ],
  [
    "Usage",
    () => import("../usage/store.js").then((m) => m.ensureUsageTable()),
  ],
  [
    "UsageAlerts",
    () => import("../usage/alerts-store.js").then((m) => m.ensureTables()),
  ],
  [
    "UsageBudgets",
    () =>
      import("../integrations/usage-budget-store.js").then((m) =>
        m.ensureTables(),
      ),
  ],
  [
    "WorkspaceConnections",
    () =>
      import("../workspace-connections/store.js").then((m) =>
        m.ensureWorkspaceConnectionsTable(),
      ),
  ],
  [
    "WorkspaceUserGroups",
    () =>
      import("../workspace-connections/groups.js").then((m) =>
        m.ensureWorkspaceUserGroupsTable(),
      ),
  ],
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
