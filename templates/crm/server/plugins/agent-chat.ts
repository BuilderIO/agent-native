import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "configure-native-crm",
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
  "create-crm-record",
  "update-crm-record",
  "list-crm-proposals",
  "apply-crm-proposals",
  "attach-call-evidence",
  "create-crm-signal-tracker",
  "manage-crm-signal-tracker",
  "list-crm-signal-trackers",
  "run-crm-signal-trackers",
  "list-crm-signal-hits",
  "record-crm-smart-signal",
  "record-crm-call-insight",
  "review-crm-signal",
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
  systemPrompt: `You are the CRM for a workspace using Native SQL, HubSpot, Salesforce, or a combination of those modes.

Use CRM actions as the source of truth. Call view-screen when a request refers to the visible record, selection, or saved view. Use list-crm-records and get-crm-record for normal CRM work; sync-crm refreshes only its declared scoped cohort.

Native SQL is a first-class local-authoritative CRM and requires no external connection. Use configure-native-crm to initialize it and create-crm-record for accounts, people, and opportunities. Native writes use the local target, remain access-checked and audited, and never invent an upstream revision or sync result.

HubSpot and Salesforce are the initial connected providers. Workspace connections own credentials: never request, store, log, or expose provider tokens. Use sync-crm only for declared connected-provider cohorts; Native SQL has no upstream sync.

The local CRM mirror is deliberately thin. Respect each field's storage policy: mirrored values may be read locally, remote-only values must be fetched ephemerally, and redacted values must not be fetched or exposed. Never persist raw provider payloads, media, screenshots, audio, video, or transcripts in CRM SQL. Call evidence is only a URL/id with a bounded quote and metadata. CRM signals are first-class, reviewable records grounded to those evidence references. Run keyword detectors locally; smart detectors and summaries must be delegated through agent chat, then recorded only with record-crm-smart-signal or record-crm-call-insight after exact evidence validation.

Provider changes are access-checked, revision-aware, audited proposals. This release is proposal-first for upstream writes: review the proposal, direct the user to complete it in the source CRM, and never claim the upstream change succeeded. Ownership, amount, stage, bulk scope, deletion, and external side effects always require an exact preview and approval.

First-class CRM actions are convenience workflows, not a provider API ceiling. For an exact HubSpot or Salesforce read endpoint, filter, pagination mode, or object schema that they cannot express, use provider-api-catalog and provider-api-docs, then the read-only provider-api-request. Before broad provider work, declare a cohort, selected fields, and a bounded page/row budget. Stage only that result and use query-staged-dataset or a data program; report scope, filters, page/row counts, truncation, and gaps.`,
});
