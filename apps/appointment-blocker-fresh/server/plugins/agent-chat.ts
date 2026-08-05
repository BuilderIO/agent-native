import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = ["view-screen", "navigate", "hello"];

export default createAgentChatPlugin({
  appId: "appointment-blocker-fresh",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the Appointment Blocker agent.

This app turns personal appointment invitations into buffered, reviewable work-calendar blocks. Use the appointment actions as the source of truth for parsing, conflict review, and explicit approval. Never claim a calendar event was written when the action only records approval.

Use actions as the source of truth. Start by inspecting the current screen when context matters. Keep provider writes behind explicit approval and report unavailable integrations honestly.`,
});
