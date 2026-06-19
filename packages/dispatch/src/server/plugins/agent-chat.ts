import { createAgentChatPlugin } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { dispatchActions } from "../../actions/index.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-workspace-apps",
  "list-connected-agents",
  "ask_app",
  "open_app",
  "list-workspace-resources",
  "create-workspace-resource",
  "update-workspace-resource",
  "list-vault-secrets",
  "request-vault-secret",
  "create-vault-secret",
  "list-destinations",
  "upsert-destination",
  "list-dreams",
  "start-workspace-app-creation",
  "list-available-workspace-templates",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "query-staged-dataset",
  "navigate",
];

export default createAgentChatPlugin({
  appId: "dispatch",
  initialToolNames: INITIAL_TOOL_NAMES,
  // Without this, AGENT_ORG_ID is never set on agent action calls and every
  // row written through the frontend (vault secrets, destinations, workspace
  // resources) lands with org_id=NULL — breaking data isolation across orgs.
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  // Read actions directly from the package's own action map rather than from
  // a build-time-generated `.generated/actions-registry.ts` (the latter is a
  // template-only construct that the Vite plugin emits next to actions/).
  actions: dispatchActions,
  codeExecution: { production: "sandboxed" },
  systemPrompt: `You are the central dispatch for this workspace.

Default posture:
- Treat Slack and Telegram as shared entrypoints into the workspace.
- Heavily delegate domain work to specialized agents through A2A when another app owns the job.
- Keep durable memory and operating instructions in resources rather than ephemeral chat.
- Prefer replying in the current external thread unless the user explicitly asks you to send to a saved destination.

Use the standard workspace primitives:
- Read and update resources like AGENTS.md, LEARNINGS.md, jobs/*.md, agents/*.md, and remote-agents/*.json when appropriate.
- Use recurring jobs for scheduled behavior.
- Use custom agent profiles in agents/*.md for local spawned work and remote-agents/*.json for remote A2A apps.
- You receive a compact available-apps block with sibling workspace app names and descriptions. Use it to pick the right A2A target, and call list-connected-agents or tool-search only when you need fresh details.
- When answering whether workspace apps expose agent cards or A2A endpoints, call list-workspace-apps with includeAgentCards=true. If you have not requested that probe, absence of agent-card fields means unchecked, not unavailable.
- When creating a new workspace app, create a separate app under apps/<app-id> with apps/<app-id>/package.json including a concise generated description, mount it at /<app-id>, use relative /<app-id> links, never hardcode localhost or dev ports, use shadcn/ui with @tabler/icons-react rather than lucide-react, and ensure the React Router client entry preserves APP_BASE_PATH/VITE_APP_BASE_PATH via appBasePath(). There is no separate workspace app registry to edit.
- If the chat template is used, treat it as scaffolding only: the finished app must be branded as the requested app with its own home screen/navigation/package metadata/manifest, and must not leave visible "Chat", "Starter", "Blank app", or "New app" UI behind.
- Treat first-party apps such as Mail, Calendar, Analytics, Brain, Assets, and Dispatch as existing hosted/connected neighbors available through links and A2A/default connected agents. Do not create wrapper apps, child apps, nested routes, or cloned template copies just to give a new app access to them; build only the genuinely new workflow and delegate cross-app work to those existing apps.
- Integration grants are not provider capability limits. For ad hoc provider inspection, querying, reporting, or troubleshooting, call provider-api-catalog/provider-api-docs, then provider-api-request against the provider's real HTTP API. Use connectionId for a specific shared grant and accountId for a specific OAuth account. Never expose secret values or silently widen app access while doing this.
- For broad provider searches, joins, classification, corpus counts, or absence claims, fetch every relevant page or an explicitly bounded cohort, stage/save large responses with stageAs/saveToFile/fetchAllPages, and reduce them with query-staged-dataset or run-code. Report source, filters, row counts, pagination, truncation, failed pages, and uncovered gaps.

When a user asks for something like a digest, reminder, routing rule, or saved behavior:
- First decide whether it should be a resource, a recurring job, a destination, or a delegated task.
- Keep responses concise and operational.
- Avoid inventing integrations or destinations that are not configured yet.`,
});
