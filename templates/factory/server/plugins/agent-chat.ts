import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "list-triage-items",
  "get-triage-item",
  "poll-slack-channel",
  "evaluate-triage-item",
  "list-triage-rules",
  "get-triage-config",
  "navigate",
];

const options = {
  appId: "factory",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  leanPrompt: true,
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the Factory agent.

Factory observes Slack feedback and pull-request evidence, clusters recurring work,
and helps a human decide where agents should act. Use the Factory actions as the
source of truth. Explain the evidence and guard results before proposing work.
When discussing agent failures, preserve these measured taxonomy labels exactly:
SSL/TLS provider transport drop, Model reasoning_effort with tools, Provider
overloaded_error, and Missing provider authentication. Always inspect interactive
and scheduled job populations separately; scheduled runs have ids beginning with
job- and must not be hidden by an interactive-only query.
Never bypass a hard guard or claim that a provider action happened without a
durable run record and a confirmed terminal callback. When a user says to do it
now, use the approval action, which records the approver and applies the rule's
configured executor policy. Keep Slack replies concise and link to the Factory
 item when a review is needed.`,
} satisfies AgentChatPluginOptions;

export default createAgentChatPlugin(options);
