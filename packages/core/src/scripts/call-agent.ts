import type { ActionTool } from "../agent/types.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import { A2AClient, callAgent } from "../a2a/client.js";

export const tool: ActionTool = {
  description:
    "Call another agent to ask a question or request a task. Use this to get information from other apps (e.g., ask Analytics for data, ask Mail to search emails, ask Content for documents).",
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description:
          "Agent name or ID. Includes built-in agents (e.g., 'analytics', 'mail', 'content') and any custom agents configured in resources.",
      },
      message: {
        type: "string",
        description: "The message/question to send to the agent",
      },
    },
    required: ["agent", "message"],
  },
};

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
): Promise<string> {
  const { agent: agentIdOrName, message } = args;

  if (!agentIdOrName) return "Error: --agent is required";
  if (!message) return "Error: --message is required";

  const agent = await findAgent(agentIdOrName);
  if (!agent) {
    const available = (await discoverAgents()).map((a) => a.name).join(", ");
    return `Error: Agent "${agentIdOrName}" not found. Available agents: ${available || "(none)"}`;
  }

  try {
    // If we have a send context, use streaming so the UI shows progressive text
    if (context?.send) {
      const client = new A2AClient(agent.url);
      const callerEmail = process.env.AGENT_USER_EMAIL;

      // Build metadata with identity
      const a2aMetadata: Record<string, unknown> = {};
      if (callerEmail) a2aMetadata.userEmail = callerEmail;
      if (process.env.NODE_ENV === "production" && callerEmail) {
        try {
          const { listOAuthAccountsByOwner } =
            await import("../oauth-tokens/store.js");
          const accounts = await listOAuthAccountsByOwner(
            "google",
            callerEmail,
          );
          const tokens = accounts[0]?.tokens;
          if (tokens?.access_token) {
            a2aMetadata.googleToken = tokens.access_token;
          }
        } catch {}
      }

      let responseText = "";
      let lastSentLength = 0;

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "start",
      });

      try {
        for await (const task of client.stream(
          {
            role: "user",
            parts: [{ type: "text", text: message }],
          },
          Object.keys(a2aMetadata).length > 0
            ? { metadata: a2aMetadata }
            : undefined,
        )) {
          const newText =
            task.status?.message?.parts
              ?.filter(
                (p): p is { type: "text"; text: string } => p.type === "text",
              )
              ?.map((p) => p.text)
              ?.join("") ?? "";

          if (newText.length > lastSentLength) {
            context.send({
              type: "agent_call_text",
              agent: agent.name,
              text: newText.slice(lastSentLength),
            });
            lastSentLength = newText.length;
          }
          responseText = newText;
        }
      } catch {
        // Streaming failed — fall back to blocking call
        if (!responseText) {
          responseText = await callAgent(agent.url, message, {
            userEmail: callerEmail,
          });
        }
      }

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "done",
      });

      return responseText || "(empty response)";
    }

    // No context — use simple blocking call
    const response = await callAgent(agent.url, message, {
      userEmail: process.env.AGENT_USER_EMAIL,
    });
    return response || "(empty response)";
  } catch (err: any) {
    return `Error calling ${agent.name}: ${err?.message}`;
  }
}
