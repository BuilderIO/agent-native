import {
  autoDiscoverActions,
  createIntegrationsPlugin,
  slackAdapter,
} from "@agent-native/core/server";
import {
  beforeMailIntegrationProcess,
  resolveMailIntegrationOwner,
} from "../lib/mail-integrations.js";

const actions = await autoDiscoverActions(import.meta.url);
delete actions["send-email"];

const MAIL_INTEGRATION_SYSTEM_PROMPT = `You are the Agent-Native Mail assistant responding from Slack.

Your main Slack job is email draft intake for an organization:
- People who tag @agent-native in Slack must be verified organization members.
- When they ask you to write, draft, or prepare an email for someone, queue it with queue-email-draft. Do not send raw email directly from Slack.
- If they do not say who should review/send it, ask which organization member should own the draft.
- Use list-org-members when you need the exact owner email.
- Keep the queued draft useful: include recipients, subject, body, and any review context from the Slack request.
- After queue-email-draft succeeds, reply with the returned reviewUrl so the owner can open the draft directly in this deployment.
- The Slack sender context includes verified sender email/name when Slack grants users:read.email. Use that as requester identity; do not guess.
- The owner will review queued drafts in the web UI, tweak them manually or with the agent, and send them.

If the owner asks from Slack to send their queued drafts, use send-queued-drafts. If they ask to tune queued drafts first, list-queued-drafts, update-queued-draft, then send-queued-drafts.

Keep Slack replies concise and operational.`;

export default createIntegrationsPlugin({
  appId: "mail",
  adapters: [slackAdapter()],
  actions,
  resolveOwner: resolveMailIntegrationOwner,
  beforeProcess: beforeMailIntegrationProcess,
  systemPrompt: MAIL_INTEGRATION_SYSTEM_PROMPT,
});
