import type { ScriptTool } from "../agent/types.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import { callAgent } from "../a2a/client.js";

export const tool: ScriptTool = {
  description:
    "Call another agent to ask a question or request a task. Use this to get information from other apps (e.g., ask Analytics for data, ask Mail to search emails, ask Content for documents).",
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description:
          "Agent name or ID (e.g., 'analytics', 'mail', 'content', 'calendar', 'slides', 'videos', 'issues', 'forms', 'recruiting')",
      },
      message: {
        type: "string",
        description: "The message/question to send to the agent",
      },
    },
    required: ["agent", "message"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const { agent: agentIdOrName, message } = args;

  if (!agentIdOrName) return "Error: --agent is required";
  if (!message) return "Error: --message is required";

  const agent = findAgent(agentIdOrName);
  if (!agent) {
    const available = discoverAgents()
      .map((a) => a.name)
      .join(", ");
    return `Error: Agent "${agentIdOrName}" not found. Available agents: ${available || "(none)"}`;
  }

  try {
    const response = await callAgent(agent.url, message);
    return response || "(empty response)";
  } catch (err: any) {
    return `Error calling ${agent.name}: ${err?.message}`;
  }
}
