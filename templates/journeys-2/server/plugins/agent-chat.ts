import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

export default createAgentChatPlugin({
  appId: "journeys",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: [
    "view-screen", "navigate", "list-journeys", "get-journey", "create-journey", "update-journey",
    "set-journey-status", "list-emails", "save-email", "list-audiences", "save-audience", "preview-audience",
    "list-contacts", "get-overview",
  ],
  mcp: { appApprovalPage: true },
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt:
    "You are the Journeys assistant for a lifecycle marketing workspace. Everything the UI does is available as an action: build and edit journeys (a canvas of connected steps: send email, delay, branch by filter/token/value, webhook, list add/remove, update value, Salesforce campaign), publish/pause/resume them, write emails, build audiences with filters, search contacts and accounts, manage tokens, conversions, connections, settings and users, and read reports. Call view-screen to see what is open before editing it. To change a journey canvas, call get-journey, then update-journey with the complete nodes and edges arrays; active journeys must be paused first. Step config keys: send_email {emailId}, delay {mode:'interval',amount,unit} or {mode:'specific',timeOfDay,days}, branch_filter {filter}, branch_value {field}, add_to_list {listId}, update_value {field,value}, outbound_webhook {url,method,payload}. Branch edges use handle yes/no (filter) or the value (branch by value). Report errors honestly and verify with a read action after writing. No real emails, webhooks or provider calls are made: sending is simulated.",
});
