import type { ActionTool } from "../agent/types.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import { A2AClient, callAgent, signA2AToken } from "../a2a/client.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import { getOrgDomain } from "../org/context.js";

export const tool: ActionTool = {
  description:
    "Call a DIFFERENT, separately-deployed agent app to ask a question or delegate a task. This is strictly for cross-app A2A communication — for example, asking the mail agent to send an email while you are the calendar agent. NEVER use this to call your own app or perform actions you can do with your own tools. Using call-agent on yourself will fail and waste time.",
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description:
          "Name or URL of a DIFFERENT deployed agent app (e.g. 'mail', 'calendar', 'analytics'). Must not be the current app's own name.",
      },
      message: {
        type: "string",
        description: "The message/question to send to the other agent",
      },
    },
    required: ["agent", "message"],
  },
};

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
  selfAppId?: string,
): Promise<string> {
  const { agent: agentIdOrName, message } = args;

  if (!agentIdOrName) return "Error: --agent is required";
  if (!message) return "Error: --message is required";

  // Prevent self-calls — the agent must use its own registered tools instead
  if (selfAppId && agentIdOrName.toLowerCase() === selfAppId.toLowerCase()) {
    return `Error: You cannot use call-agent to call yourself (${selfAppId}). Use your own registered actions/tools instead. call-agent is only for communicating with OTHER separately-deployed apps.`;
  }

  const agent = await findAgent(agentIdOrName, selfAppId);
  if (!agent) {
    const available = (await discoverAgents(selfAppId))
      .map((a) => a.name)
      .join(", ");
    return `Error: Agent "${agentIdOrName}" not found. Available agents: ${available || "(none)"}`;
  }

  try {
    // If we have a send context, use streaming so the UI shows progressive text
    if (context?.send) {
      const callerEmail = getRequestUserEmail();

      // Build metadata with identity
      const a2aMetadata: Record<string, unknown> = {};
      if (callerEmail) a2aMetadata.userEmail = callerEmail;

      // Include org domain for cross-app org resolution
      let callerOrgDomain: string | undefined;
      const orgId = getRequestOrgId();
      if (orgId) {
        try {
          const domain = await getOrgDomain(orgId);
          if (domain) {
            callerOrgDomain = domain;
            a2aMetadata.orgDomain = domain;
          }
        } catch {}
      }

      // Sign JWT with identity + org domain for the streaming client
      let apiKey: string | undefined;
      if (callerEmail && process.env.A2A_SECRET) {
        try {
          apiKey = await signA2AToken(callerEmail, callerOrgDomain);
        } catch {}
      }

      const client = new A2AClient(agent.url, apiKey);

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
            orgDomain: callerOrgDomain,
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
    const email = getRequestUserEmail();
    let domain: string | undefined;
    const currentOrgId = getRequestOrgId();
    if (currentOrgId) {
      try {
        domain = (await getOrgDomain(currentOrgId)) ?? undefined;
      } catch {}
    }
    const response = await callAgent(agent.url, message, {
      userEmail: email,
      orgDomain: domain,
    });
    return response || "(empty response)";
  } catch (err: any) {
    return `Error calling ${agent.name}: ${err?.message}`;
  }
}
