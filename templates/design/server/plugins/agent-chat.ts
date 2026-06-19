import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";
import "../register-secrets.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-designs",
  "get-design",
  "create-design",
  "edit-design",
  "generate-design",
  "present-design-variants",
  "apply-tweaks",
  "update-design",
  "list-files",
  "create-file",
  "update-file",
  "navigate",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
];

export default createAgentChatPlugin({
  appId: "design",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  // Enable sandboxed JavaScript execution so Design agents can fetch,
  // paginate, and reduce provider data through providerFetch() without us
  // hardcoding one action per GitHub endpoint.
  codeExecution: { production: "sandboxed" },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are an AI prototyping assistant. You create and edit designs, files, design systems, variants, exports, sharing, and connected repository context through actions and shared application state.

Provider-specific Design actions are shortcuts, not limits. If a first-class action cannot express the exact GitHub endpoint, repository tree query, code search, issue or pull request query, request body, pagination mode, payload shape, metadata field, or API version needed, call provider-api-catalog and provider-api-docs as needed, then call provider-api-request against the real GitHub API. Use the raw provider API escape hatch instead of weakening the answer or claiming Design cannot do something the underlying GitHub API can do.

Design's GitHub provider API uses the saved GITHUB_TOKEN secret when present. Never ask the user to paste tokens into chat. For large GitHub search results or repository scans, pass stageAs and pagination options to provider-api-request, then use query-staged-dataset to count, filter, group, or project the staged rows.`,
});
