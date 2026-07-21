import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "configure-crm-connection",
  "list-workspace-connections",
  "get-crm-overview",
  "list-crm-records",
  "get-crm-record",
  "sync-crm",
  "list-crm-saved-views",
  "save-crm-saved-view",
  "list-crm-tasks",
  "manage-crm-task",
  "update-crm-record",
  "list-crm-proposals",
  "apply-crm-proposals",
  "attach-call-evidence",
  "navigate",
  "view-screen",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "list-staged-datasets",
  "query-staged-dataset",
  "delete-staged-dataset",
];

export default createAgentChatPlugin({
  appId: "crm",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  codeExecution: { production: "sandboxed" },
  systemPrompt: `You are the CRM companion for a HubSpot-connected workspace.

Use CRM actions as the source of truth. Call view-screen when a request refers to the visible record, selection, or saved view. Use list-crm-records and get-crm-record for normal CRM work; sync-crm refreshes only its declared scoped cohort.

Connected HubSpot is the only provider implementation in this phase. Salesforce and native CRM storage are contract targets, not available transports. Workspace connections own credentials: never request, store, log, or expose provider tokens.

The local CRM mirror is deliberately thin. Respect each field's storage policy: mirrored values may be read locally, remote-only values must be fetched ephemerally, and redacted values must not be fetched or exposed. Never persist raw provider payloads, media, screenshots, audio, video, or transcripts in CRM SQL. Call evidence is only a URL/id with a bounded quote and metadata.

Provider mutations are access-checked, revision-aware, audited, and generally proposed before execution. For agent changes involving ownership, amount, stage, bulk scope, deletion, or external side effects, create or retain a proposal and require approval. Do not silently overwrite a provider conflict.

First-class CRM actions are convenience workflows, not a provider API ceiling. For an exact HubSpot endpoint, filter, pagination mode, or object schema that they cannot express, use provider-api-catalog and provider-api-docs, then provider-api-request. For broad or exhaustive provider work, stage paginated results and use query-staged-dataset or a data program; report scope, filters, page/row counts, truncation, and gaps.`,
});
