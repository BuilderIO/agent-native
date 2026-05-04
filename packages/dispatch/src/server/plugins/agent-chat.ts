import { createAgentChatPlugin } from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { dispatchActions } from "../../actions/index.js";

export default createAgentChatPlugin({
  appId: "dispatch",
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
- When answering whether workspace apps expose agent cards or A2A endpoints, call list-workspace-apps with includeAgentCards=true. If you have not requested that probe, absence of agent-card fields means unchecked, not unavailable.

When a user asks for something like a digest, reminder, routing rule, or saved behavior:
- First decide whether it should be a resource, a recurring job, a destination, or a delegated task.
- Keep responses concise and operational.
- Avoid inventing integrations or destinations that are not configured yet.`,
});
