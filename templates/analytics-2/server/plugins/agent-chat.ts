import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  registerChatThreadSharingPolicy,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { WORKSPACE_CHAT_APP_ID } from "../../app/lib/workspace-chat-scope.js";
import { persistAnalyticsThreadRun } from "../model/analytics-thread-transcript.js";
import {
  connectAnalyticsThreadQueue,
  prepareAnalyticsThreadContext,
} from "../model/analytics-thread-turns.js";

/**
 * The app's action registry, mounted as HTTP routes and agent tools.
 *
 * The default plugin discovers actions by walking the filesystem at runtime,
 * which finds nothing inside the deployed bundle. Loading the generated static
 * registry is what every other app on this runtime does, and it is what keeps
 * `/_agent-native/actions/<name>` answering on a served build.
 */
const actions = loadActionsFromStaticRegistry(actionsRegistry);

/** Tools the agent starts with: the reads and writes a data question needs. */
const INITIAL_TOOL_NAMES = [
  ...[
    "list-projects",
    "resolve-project",
    "search-workspace",
    "get-project",
    "get-thread-summary",
    "add-project-cell",
    "save-project-cell",
    "get-notebook-pending-changes",
    "start-notebook-run",
    "run-project-cell",
    "get-notebook-run",
    "get-notebook-result-page",
    "list-data-connections",
    "list-connection-datasets",
    "view-screen",
    "navigate",
    "open-project",
  ].filter((name) => Object.prototype.hasOwnProperty.call(actions, name)),
  "render-data-widget",
];

registerChatThreadSharingPolicy(WORKSPACE_CHAT_APP_ID, async (threadId) => {
  const { workspaceChatThreadPermitsSharing } =
    await import("../model/analytics-thread-bootstrap.js");
  return workspaceChatThreadPermitsSharing(threadId);
});

export default createAgentChatPlugin({
  appId: "analytics-2",
  onQueuedSubmissionDrainReady: connectAnalyticsThreadQueue,
  prepareRequest: prepareAnalyticsThreadContext,
  onAgentRunComplete: persistAnalyticsThreadRun,
  actions,
  corpusTools: "lazy",
  frameworkTools: { database: "off" },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `Review: list-projects, get-project, add-project-cell, save-project-cell (bound thread), get-notebook-pending-changes (threadId from view-screen), get-notebook-run, get-notebook-result-page (if review_context_required, open thread).
When no notebook thread is open: list-connection-datasets, create-project once with starter {kind: "cells"} (SQL resultVariable + chart), navigate.
"That query" / "it" when no project is open or this thread's own notebook is empty: call resolve-project (which "recent-query"), navigate, get-project, save-project-cell, name both (ask only if none or multiple SQL cells).
Ask: view-screen gives threadId; get-thread-summary gives backing notebook (add cells there, run SQL via start-notebook-run -> get-notebook-run with threadId, never run-project-cell, pass resultId as widgetId to render-data-widget).
Named project: open-project once with name first (no search-workspace). Home threads have an empty private notebook, so never run-project-cell on another project from one: open it first, get-project-summary once (no get-project/run-project-cell/start-notebook-run for "how is it doing"). Note errored/unrun/partial cells in <6 lines.
Recent projects: navigate (view "home", intent "open") + list-projects. Search: search-workspace (text, intent "open").
Browse ("browse tables", "show tables"): list-data-connections (builtin-sample-data default), navigate with kind data-connection, id, intent open, list-connection-datasets, navigate with dataConnectionId, tableId (named or first table), intent open to /home/data/... even from inside a project (never /project/; schemaId for schema).
Inline charts: render-data-widget with real data; never invent.
Run read-only SELECTs. Run them with run-project-cell right away (or start-notebook-run in Ask/accepted runs, including pending_review candidates); never ask "Should I run the cell now?" or ask permission before each SELECT. Ask first only for SQL that changes data or schema (INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE).
When preview.partial true, nextOffset or truncated (or rows < manifest.rowCount), say partial and never infer absence, extremes, or grain from a first-N page; Compute every aggregate in a SQL cell over the full data & report preview.totalRows.
Inputs: bind SQL with {{ name }} or IN ({{ names | array }}); query-driven options use dynamicOptions {producerCellId, valueFieldId, displayFieldId?} (IDs from get-notebook-execution + get-notebook-result-page), read choices via get-notebook-input-choices, and pass inputOptionsResultId on save-project-cell.
Reply: name only cells whose IDs a tool call returned (createdCellId/get-project). Do not claim a cell you did not add; mark pending_review unconfirmed and verify get-notebook-run/run-project-cell before reporting output.`,
});
