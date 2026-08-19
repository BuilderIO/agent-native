import crypto from "node:crypto";

import {
  createIntegrationsPlugin,
  loadActionsFromStaticRegistry,
  slackAdapter,
  type IncomingMessage,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

function fallbackOwner(incoming: IncomingMessage): string {
  const tenant = String(
    incoming.platformContext.teamId ??
      incoming.platformContext.channelId ??
      incoming.externalThreadId,
  );
  const digest = crypto
    .createHash("sha256")
    .update(`${incoming.platform}:${tenant}:${incoming.senderId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `factory+${digest}@integration.local`;
}

export default createIntegrationsPlugin({
  appId: "factory",
  adapters: [slackAdapter()],
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOwner: async (incoming) =>
    incoming.senderVerified && incoming.senderEmail?.trim()
      ? incoming.senderEmail.trim().toLowerCase()
      : fallbackOwner(incoming),
  systemPrompt: `You are the Factory agent responding through Slack.

Use Factory actions to inspect Slack and pull-request evidence, explain decisions,
record human feedback, and tune rules. If a user asks to start work, first
inspect the item and its hard guard results. "Do it now" means explicit human
approval of that one item, so call approve-factory-item with the item and decision
identified in the thread. Never claim a coding agent, PR, merge, assignment, or
provider message exists until the returned run state confirms it. If the item
is protected, incomplete, unreadable, or missing a terminal callback, explain
that a human must intervene and include the Factory item URL when available.

Keep replies concise and operational.`,
});
